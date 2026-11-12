// Levels of an ambient transaction and of a session: their state, how they start, run their callbacks, and end, and how the errors of their cleanup combine.

import type { AsyncLocalStorage } from "node:async_hooks"

import type { IsolationLevel } from "../database"
import type { Connection, SqlStatement } from "../driver"
import { createStatement } from "../driver"

import { settleUnlessAborted } from "./abort"
import type { SessionLocks } from "./advisory-lock"
import { ConnectionWatch } from "./connection-loss"
import type { LevelSetting } from "./settings"
import { applySettings } from "./settings"
import type { TurnQueue } from "./turns"

/** Transaction, savepoint nested in it, or session, run by one callback in its own async context, a test fixture without a context, or an open test transaction whose context the callbacks of `run` share. */
export interface TransactionLevel {
  /** Connection of the level, which the watch of a transaction of `transaction` or of a session wraps for the levels nested in it too. */
  readonly connection: Connection
  /** Watch of the connection of a session, or of a transaction of `transaction` that is not a savepoint; `undefined` for every other level. */
  readonly watch: ConnectionWatch | undefined
  /** Enclosing level: the transaction or savepoint of a savepoint, or the session of a transaction that runs on its connection. */
  readonly parent: TransactionLevel | undefined
  /** Number of enclosing levels of its transaction, which names the savepoint of a nested level. */
  readonly depth: number
  /** Whether the level is a session rather than a transaction or a savepoint: its statements run on its connection outside a transaction block. */
  readonly session: boolean
  /** Whether the level is a savepoint of its enclosing level rather than a session or a transaction of its own, which a level nested in a session is too. */
  readonly savepoint: boolean
  /**
   * Whether the level or an enclosing one is a transaction of `transaction` rather than a test transaction, the seed of a test fixture, or a test fixture.
   *
   * Code under test then starts a transaction of its own where it does in production, which runs as a savepoint of the test level.
   */
  readonly inTransaction: boolean
  /**
   * A level accepts statements only while `open`; it is `starting` until its `BEGIN` or `SAVEPOINT` and its settings complete, and a session until its settings do.
   *
   * A nested level is `reserved` before `starting` while it checks the isolation level of its transaction, before its `SAVEPOINT` is sent, so ending it sends nothing.
   */
  state: "reserved" | "starting" | "open" | "closing" | "closed"
  /** Active nested level, reserved before its `SAVEPOINT` is sent. */
  child: TransactionLevel | undefined
  /** Failure to end a nested level: the statement may not have reached PostgreSQL, so this level can only roll back. */
  rollbackOnly: Rejection | undefined
  /** The single cleanup of the level, started by whoever ends it first. */
  cleanup: Promise<Cleanup> | undefined
  /** Why something other than its callback ended the level, which its rejection reports. */
  endedBy: "enclosing level" | "preemption" | "abort" | undefined
  /** Statement that restores the values that the settings of a savepoint or of a session replaced, sent before the `RELEASE` of the savepoint or before the connection of the session is released. */
  restore: SqlStatement | undefined
  /** Isolation level of the transaction, such as `read committed`, when it is known: given to its `BEGIN`, or read for a nested level. */
  isolation: string | undefined
  /** Advisory locks that a session took with `tryLock`, which it releases before its connection returns to the driver; `undefined` for every other level and for a session before its first `tryLock`. */
  locks: SessionLocks | undefined
  /**
   * Turns of the callbacks that share an open test transaction; `undefined` for every other level.
   *
   * Its statements and nested levels wait for their turn instead of rejecting while it has a nested level.
   */
  turns: TurnQueue | undefined
}

/** Options of starting a level; the options of a test transaction and of a test fixture pass as they are, so their fields keep these names. */
export interface LevelOptions {
  /** Abort signal of a test level. */
  readonly signal?: AbortSignal
  /** Settings that the level sets until it ends. */
  readonly settings?: readonly LevelSetting[]
  /** Isolation level of the transaction of the level. */
  readonly isolation?: IsolationLevel
}

/** Options of a level started without options, shared so that such a start allocates none. */
export const noLevelOptions: LevelOptions = {}

/** Error to reject with; a later cleanup error suppresses it instead of replacing it. */
export interface Rejection {
  readonly error: unknown
}

/** Result of ending a level. */
export interface Cleanup {
  readonly rejection?: Rejection
}

/** Result of running the callback of a level and ending the level. */
export interface Outcome<T> extends Cleanup {
  readonly result?: T
}

const beginStatement = /* @__PURE__ */ createStatement("BEGIN")
const isolatedBeginStatements: Readonly<Record<IsolationLevel, SqlStatement>> = {
  "read committed": /* @__PURE__ */ createStatement("BEGIN ISOLATION LEVEL READ COMMITTED"),
  "repeatable read": /* @__PURE__ */ createStatement("BEGIN ISOLATION LEVEL REPEATABLE READ"),
  serializable: /* @__PURE__ */ createStatement("BEGIN ISOLATION LEVEL SERIALIZABLE"),
}
const readIsolationStatement = /* @__PURE__ */ createStatement(
  "SELECT current_setting('transaction_isolation')",
)
const commitStatement = /* @__PURE__ */ createStatement("COMMIT")
const rollbackStatement = /* @__PURE__ */ createStatement("ROLLBACK")

/**
 * Statement that starts the transaction of a level that is not a savepoint, a transaction of `transaction`, a test transaction, or the first test fixture, at `isolation` if given.
 *
 * PostgreSQL takes the isolation level only before the first query of a transaction, so `BEGIN` sets it.
 */
export function getBeginStatement(isolation: IsolationLevel | undefined): SqlStatement {
  return isolation ? isolatedBeginStatements[isolation] : beginStatement
}

/**
 * Creates the state of a `starting` level on `connection`: a savepoint of `parent`, or a transaction, in the session `parent` if given.
 *
 * It sends no SQL and does not reserve the level as the `child` of `parent`; the caller does both.
 * `transaction` tells whether the level is a transaction of `transaction` rather than a level of the test helpers.
 * A transaction of `transaction` that is not a savepoint watches its connection for a `ConnectionError`.
 * `isolation` is the isolation level that a level that is not a savepoint begins with.
 */
export function createLevel(
  connection: Connection,
  parent: TransactionLevel | undefined,
  transaction: boolean,
  isolation?: IsolationLevel,
): TransactionLevel {
  const enclosing = parent && !parent.session ? parent : undefined
  const watch = transaction && !enclosing ? new ConnectionWatch(connection) : undefined
  return {
    connection: watch ?? connection,
    watch,
    parent,
    depth: enclosing ? enclosing.depth + 1 : 0,
    session: false,
    savepoint: enclosing !== undefined,
    inTransaction: transaction || (enclosing?.inTransaction ?? false),
    state: "starting",
    child: undefined,
    rollbackOnly: undefined,
    cleanup: undefined,
    endedBy: undefined,
    restore: undefined,
    isolation: enclosing ? enclosing.isolation : isolation,
    locks: undefined,
    turns: undefined,
  }
}

/**
 * Starts a nested level of `parent` with the settings of `options`, at the isolation level of its transaction, rejecting when it cannot start.
 *
 * `transaction` tells whether the level is a transaction of `transaction` rather than a level of the test helpers.
 * A level whose `isolation` differs from that of its transaction rejects without `SAVEPOINT`, since PostgreSQL sets the isolation level only for a whole transaction.
 * A level whose settings fail rolls back to its savepoint first.
 * Aborted by `signal` while it checks `isolation`, it rejects with the reason without `SAVEPOINT`.
 * The failure suppresses the reason of `signal` when the signal aborted before it.
 */
export async function startNestedLevel(
  parent: TransactionLevel,
  transaction: boolean,
  { signal, settings, isolation }: LevelOptions = noLevelOptions,
): Promise<TransactionLevel> {
  // Reserving the level before SAVEPOINT is sent keeps statements of the parent from running inside it.
  const level = createLevel(parent.connection, parent, transaction)
  parent.child = level
  if (isolation) {
    // Ending the level before its SAVEPOINT is sent must not roll back to a savepoint that does not exist.
    level.state = "reserved"
    await checkIsolation(level, isolation, signal)
    // A level that its enclosing level ended during the check must not create its savepoint.
    if (level.cleanup) {
      return level
    }
    if (signal?.aborted) {
      closeStarting(level)
      throw signal.reason
    }
    level.state = "starting"
  }
  try {
    await level.connection.execute(createStatement(`SAVEPOINT ${getSavepointName(level)}`))
  } catch (error) {
    if (!level.cleanup) {
      closeStarting(level)
      throw suppressAbortReason(error, signal)
    }
    // Its enclosing level ended while SAVEPOINT was running and started its cleanup.
    throw suppressAbortReason(combineRejections({ error }, await level.cleanup)!.error, signal)
  }
  if (settings) {
    try {
      await applySettings(level, settings)
    } catch (error) {
      // Its enclosing level may have ended it meanwhile, and then this awaits the cleanup already started.
      throw suppressAbortReason(
        combineRejections({ error }, await endLevel(level, false))!.error,
        signal,
      )
    }
  }
  return level
}

/**
 * Checks that the transaction of a `reserved` nested `level` runs at `isolation`, and rejects otherwise, closing the level.
 *
 * A failure suppresses the reason of `signal` when the signal aborted before it.
 * A level that its enclosing level ended during the check returns with its cleanup started.
 */
async function checkIsolation(
  level: TransactionLevel,
  isolation: IsolationLevel,
  signal: AbortSignal | undefined,
): Promise<void> {
  let actual = level.isolation
  if (!actual) {
    try {
      actual = (await level.connection.execute(readIsolationStatement)).rows[0]![0]!
    } catch (error) {
      if (!level.cleanup) {
        closeStarting(level)
      }
      throw suppressAbortReason(error, signal)
    }
    // A transaction keeps its isolation level once its first query runs, so its later nested levels need not read it again.
    level.parent!.isolation = actual
    level.isolation = actual
    if (level.cleanup) {
      return
    }
  }
  if (actual !== isolation) {
    closeStarting(level)
    throw suppressAbortReason(
      new Error(
        `Cannot start a nested transaction at isolation level ${isolation}: its transaction runs at ${actual}, and PostgreSQL sets the isolation level of a whole transaction`,
      ),
      signal,
    )
  }
}

/**
 * Runs `callback` in the context of a started `level` in `storage`, then ends the level.
 *
 * A level that `commits` commits only when the callback resolves with no nested level running and no nested level that failed to end.
 * When `signal` aborts, the level ends at once without waiting for the callback, and its outcome is a rejection with the reason of the signal.
 */
export async function runLevel<T>(
  storage: AsyncLocalStorage<TransactionLevel>,
  level: TransactionLevel,
  callback: () => Promise<T>,
  commits: boolean,
  signal?: AbortSignal,
): Promise<Outcome<T>> {
  if (level.cleanup) {
    // Its enclosing level ended while the level was starting.
    return getEndedOutcome(level.cleanup, createClosedError(level, undefined))
  }
  let result: T | undefined
  let rejection: Rejection | undefined
  if (signal?.aborted) {
    // Aborted while the level was starting: it ends without running the callback.
    void endLevel(level, false, "abort")
  } else {
    level.state = "open"
    try {
      result = await (signal
        ? settleUnlessAborted(
            () => storage.run(level, callback),
            signal,
            () => {
              // Ending the level at once makes the later statements of the callback fail.
              void endLevel(level, false, "abort")
              return true
            },
          )
        : storage.run(level, callback))
    } catch (error) {
      rejection = { error }
    }
  }
  if (level.cleanup) {
    // Its enclosing level or the abort of its test ended it first and started its cleanup.
    return getEndedOutcome(
      level.cleanup,
      level.endedBy === "abort" ? signal?.reason : createClosedError(level, rejection),
    )
  }
  if (!rejection && level.child) {
    rejection = {
      error: new Error(
        level.session
          ? "Session ended with an error: a transaction of it was still running when its callback finished"
          : "Transaction was rolled back: a nested transaction was still running when its callback finished",
      ),
    }
  }
  if (!rejection && level.rollbackOnly) {
    rejection = {
      error: new Error("Transaction was rolled back: a nested transaction failed to end", {
        cause: level.rollbackOnly.error,
      }),
    }
  }
  const cleanup = await endLevel(level, commits && !rejection)
  return { result, rejection: combineRejections(rejection, cleanup) }
}

/** Runs `callback` in a started `level` in `storage` with `runLevel`, returning its result or throwing its rejection. */
export async function runStarted<T>(
  storage: AsyncLocalStorage<TransactionLevel>,
  level: TransactionLevel,
  callback: () => Promise<T>,
  commits: boolean,
  signal?: AbortSignal,
): Promise<T> {
  const { result, rejection } = await runLevel(storage, level, callback, commits, signal)
  if (rejection) {
    throw rejection.error
  }
  return result as T
}

/**
 * Ends `level` once, whoever ends it: later calls return the cleanup already started.
 *
 * Statements of the level and of all levels nested in it fail from the start of the cleanup, and the nested levels end before it.
 */
export function endLevel(
  level: TransactionLevel,
  commit: boolean,
  endedBy?: TransactionLevel["endedBy"],
): Promise<Cleanup> {
  if (level.cleanup) {
    return level.cleanup
  }
  level.endedBy = endedBy
  // A level reserved before its SAVEPOINT was sent has neither a savepoint nor a nested level to end.
  if (level.state === "reserved") {
    closeStarting(level)
    level.cleanup = Promise.resolve({})
    return level.cleanup
  }
  // Rejecting statements before COMMIT or ROLLBACK keeps late ones from queuing after it and running outside of the level.
  level.state = "closing"
  // Its waiters take their turns at once and reject, since the level no longer accepts statements.
  level.turns?.close()
  const nested = level.child && endLevel(level.child, false, "enclosing level")
  level.cleanup = cleanUpLevel(level, commit, nested)
  return level.cleanup
}

async function cleanUpLevel(
  level: TransactionLevel,
  commit: boolean,
  nested: Promise<Cleanup> | undefined,
): Promise<Cleanup> {
  const nestedCleanup = await nested
  const { parent } = level
  let cleanup: Cleanup
  if (level.session) {
    // A session ends without a statement of its own; the coordinator restores its settings when it releases its connection.
    cleanup = {}
  } else if (level.savepoint) {
    cleanup = await endSavepoint(level, commit && !level.rollbackOnly)
    // Only a failure of its own statements leaves the parent in an unknown state; a nested failure was rolled back with the level.
    parent!.rollbackOnly ??= cleanup.rejection
  } else {
    // A session whose transaction fails to end keeps accepting statements unless its connection failed: PostgreSQL has ended a transaction whose COMMIT it rejected, such as for a deferred constraint.
    cleanup = await endTransaction(level, commit)
  }
  level.state = "closed"
  if (parent?.child === level) {
    parent.child = undefined
  }
  return { rejection: combineRejections(nestedCleanup?.rejection, cleanup) }
}

/**
 * Ends a transaction with `COMMIT` or `ROLLBACK`.
 *
 * A transaction whose watch recorded a `ConnectionError` rolls back instead of `COMMIT` and rejects with that error, as if its callback had rejected with it.
 */
async function endTransaction(level: TransactionLevel, commit: boolean): Promise<Cleanup> {
  const { connection, watch } = level
  // The statement may not have run, also when the callback caught its error, so COMMIT could commit the transaction without it.
  // Checking next to sending COMMIT, rather than when the callback settles, also covers the rejection of a statement that the callback did not await, which can come in between.
  const lost: Rejection | undefined =
    commit && watch?.failure ? { error: watch.failure.error } : undefined
  try {
    if (commit && !lost) {
      if (watch) {
        watch.phase = "commit"
      }
      const { command } = await connection.execute(commitStatement)
      // PostgreSQL rolls back a transaction with a failed statement on COMMIT, even when the callback caught the error.
      if (command !== "COMMIT") {
        return {
          rejection: { error: new Error("Transaction was rolled back: a statement in it failed") },
        }
      }
      return {}
    }
    await connection.execute(rollbackStatement)
    return lost ? { rejection: lost } : {}
  } catch (error) {
    return { rejection: suppress(error, lost, "Transaction rollback failed") }
  }
}

/**
 * Ends the savepoint of a nested level, releasing it on commit and rolling back to it otherwise.
 *
 * Before a release, it restores the settings that the level changed; a rollback restores them itself.
 */
async function endSavepoint(level: TransactionLevel, commit: boolean): Promise<Cleanup> {
  const name = getSavepointName(level)
  try {
    if (!commit) {
      await level.connection.execute(createStatement(`ROLLBACK TO SAVEPOINT ${name}`))
    } else if (level.restore) {
      await level.connection.execute(level.restore)
    }
    await level.connection.execute(createStatement(`RELEASE SAVEPOINT ${name}`))
    return {}
  } catch (error) {
    return { rejection: { error } }
  }
}

/** Name of the savepoint of a nested level; a level has at most one nested level, so the depth makes it unique. */
function getSavepointName(level: TransactionLevel): string {
  return `kern_${level.depth}`
}

/** Closes a level whose `SAVEPOINT` or `BEGIN` was not sent or failed, freeing its parent for other statements. */
export function closeStarting(level: TransactionLevel): void {
  level.state = "closed"
  if (level.parent?.child === level) {
    level.parent.child = undefined
  }
}

/**
 * Creates the error of `operation` on a level that rejects statements and nested levels, or returns `undefined` when it accepts them.
 *
 * A level that can only roll back keeps the failure of its nested level as the cause.
 */
export function createUnavailableError(
  level: TransactionLevel,
  operation: string,
): Error | undefined {
  if (level.session) {
    return createSessionUnavailableError(level, operation)
  }
  if (level.state !== "open") {
    return new Error(`Cannot ${operation}: its transaction is already finished`)
  }
  // PostgreSQL would run them inside the savepoint of the nested level.
  if (level.child) {
    return new Error(`Cannot ${operation}: a nested transaction is running; await it first`)
  }
  if (level.rollbackOnly) {
    return new Error(
      `Cannot ${operation}: a nested transaction failed to end, so the transaction can only roll back`,
      { cause: level.rollbackOnly.error },
    )
  }
  return undefined
}

/** Creates the error of `operation` on a session that rejects statements and transactions, or returns `undefined` when it accepts them. */
function createSessionUnavailableError(
  level: TransactionLevel,
  operation: string,
): Error | undefined {
  if (level.state !== "open") {
    return new Error(`Cannot ${operation}: its session is already finished`)
  }
  // PostgreSQL would run them inside the transaction.
  if (level.child) {
    return new Error(`Cannot ${operation}: a transaction of the session is running; await it first`)
  }
  // The connection may be lost, and a client that reconnected would run the statement without the settings of the session.
  const failure = level.watch?.failure
  if (failure) {
    return new Error(
      `Cannot ${operation}: the connection of the session failed, so the session accepts no more statements`,
      { cause: failure.error },
    )
  }
  return undefined
}

/** Error of a level that another level ended, keeping the rejection of its callback as the cause. */
function createClosedError(level: TransactionLevel, rejection: Rejection | undefined): Error {
  return new Error(
    level.endedBy === "preemption"
      ? "Transaction was rolled back: its test fixture started another level before it finished"
      : level.parent?.session
        ? "Transaction was rolled back: its session ended first"
        : "Transaction was rolled back: its enclosing transaction ended first",
    rejection && { cause: rejection.error },
  )
}

/** Outcome of a level that something other than its callback ended: a rejection with `error`, which a failed cleanup suppresses. */
export async function getEndedOutcome(cleanup: Promise<Cleanup>, error: unknown): Promise<Cleanup> {
  return { rejection: combineRejections({ error }, await cleanup) }
}

/** Error of a failure to start a test transaction, which suppresses the reason of `signal` when the signal aborted before the failure. */
export function suppressAbortReason(error: unknown, signal: AbortSignal | undefined): unknown {
  return signal?.aborted
    ? suppress(error, { error: signal.reason }, "Starting the test transaction failed").error
    : error
}

/** Rejection with the error of a cleanup, which suppresses the `earlier` rejection if there is one. */
export function combineRejections(
  earlier: Rejection | undefined,
  cleanup: Cleanup,
): Rejection | undefined {
  return cleanup.rejection
    ? suppress(cleanup.rejection.error, earlier, "Transaction rollback failed")
    : earlier
}

/** Rejection with `error`, which suppresses the `earlier` rejection if there is one. */
export function suppress(
  error: unknown,
  earlier: Rejection | undefined,
  message: string,
): Rejection {
  return { error: earlier ? new SuppressedError(error, earlier.error, message) : error }
}
