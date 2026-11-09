// Levels of an ambient transaction: their state, how they start, run their callbacks, and end, and how the errors of their cleanup combine.

import type { AsyncLocalStorage } from "node:async_hooks"

import type { Connection, SqlStatement, TransactionFailure } from "../driver"
import { createStatement } from "../driver"

import { settleUnlessAborted } from "./abort"
import type { LevelSetting } from "./settings"
import { applySettings } from "./settings"

/** Transaction or savepoint nested in it, run by one callback in its own async context, or a test fixture without a context. */
export interface TransactionLevel {
  readonly connection: Connection
  readonly parent: TransactionLevel | undefined
  /** Number of enclosing levels, which names the savepoint of a nested level. */
  readonly depth: number
  /**
   * Whether the level or an enclosing one is a transaction of `transaction` rather than a test transaction, the seed of a test fixture, or a test fixture.
   *
   * Code under test then starts a transaction of its own where it does in production, which runs as a savepoint of the test level.
   */
  readonly inTransaction: boolean
  /** A level accepts statements only while `open`; it is `starting` until its `BEGIN` or `SAVEPOINT` and its settings complete. */
  state: "starting" | "open" | "closing" | "closed"
  /** Active nested level, reserved before its `SAVEPOINT` is sent. */
  child: TransactionLevel | undefined
  /** Failure to end a nested level: the statement may not have reached PostgreSQL, so this level can only roll back. */
  rollbackOnly: Rejection | undefined
  /** The single cleanup of the level, started by whoever ends it first. */
  cleanup: Promise<Cleanup> | undefined
  /** Why something other than its callback ended the level, which its rejection reports. */
  endedBy: "enclosing level" | "preemption" | "abort" | undefined
  /** Statement that restores the values that the settings of a nested level replaced, sent before its `RELEASE`. */
  restore: SqlStatement | undefined
}

/** Error to reject with; a later cleanup error suppresses it instead of replacing it. */
export interface Rejection {
  readonly error: unknown
}

/** Result of ending a level. */
export interface Cleanup {
  readonly rejection?: Rejection
  /** Failure of the `COMMIT` or `ROLLBACK` of a transaction, which may leave it open on its connection. */
  readonly failure?: TransactionFailure
}

/** Result of running the callback of a level and ending the level. */
export interface Outcome<T> extends Cleanup {
  readonly result?: T
}

/** Statement that starts the transaction of a level without a parent: a transaction of `transaction`, a test transaction, or the first test fixture. */
export const beginStatement = /* @__PURE__ */ createStatement("BEGIN")
const commitStatement = /* @__PURE__ */ createStatement("COMMIT")
const rollbackStatement = /* @__PURE__ */ createStatement("ROLLBACK")

/**
 * Creates the state of a `starting` level on `connection`, nested in `parent` if given.
 *
 * It sends no SQL and does not reserve the level as the `child` of `parent`; the caller does both.
 * `transaction` tells whether the level is a transaction of `transaction` rather than a level of the test helpers.
 */
export function createLevel(
  connection: Connection,
  parent: TransactionLevel | undefined,
  transaction: boolean,
): TransactionLevel {
  return {
    connection,
    parent,
    depth: parent ? parent.depth + 1 : 0,
    inTransaction: transaction || (parent?.inTransaction ?? false),
    state: "starting",
    child: undefined,
    rollbackOnly: undefined,
    cleanup: undefined,
    endedBy: undefined,
    restore: undefined,
  }
}

/**
 * Reserves a nested level of `parent`, sends its `SAVEPOINT`, and applies its `settings`, rejecting when one of them fails.
 *
 * `transaction` tells whether the level is a transaction of `transaction` rather than a level of the test helpers.
 * A level whose settings fail rolls back to its savepoint first.
 * The failure suppresses the reason of `signal` when the signal aborted before it.
 */
export async function startNestedLevel(
  parent: TransactionLevel,
  transaction: boolean,
  signal?: AbortSignal,
  settings?: readonly LevelSetting[],
): Promise<TransactionLevel> {
  // Reserving the level before SAVEPOINT is sent keeps statements of the parent from running inside it.
  const level = createLevel(parent.connection, parent, transaction)
  parent.child = level
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
        "Transaction was rolled back: a nested transaction was still running when its callback finished",
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
  return { result, rejection: combineRejections(rejection, cleanup), failure: cleanup.failure }
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
  // Rejecting statements before COMMIT or ROLLBACK keeps late ones from queuing after it and running outside of the level.
  level.state = "closing"
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
  const cleanup = parent
    ? await endSavepoint(level, commit && !level.rollbackOnly)
    : await endTransaction(level.connection, commit)
  level.state = "closed"
  if (parent) {
    if (parent.child === level) {
      parent.child = undefined
    }
    // Only a failure of its own statements leaves the parent in an unknown state; a nested failure was rolled back with the level.
    parent.rollbackOnly ??= cleanup.rejection
  }
  return {
    rejection: combineRejections(nestedCleanup?.rejection, cleanup),
    failure: cleanup.failure,
  }
}

/** Ends a transaction with `COMMIT` or `ROLLBACK`. */
async function endTransaction(connection: Connection, commit: boolean): Promise<Cleanup> {
  try {
    const { command } = await connection.execute(commit ? commitStatement : rollbackStatement)
    // PostgreSQL rolls back a transaction with a failed statement on COMMIT, even when the callback caught the error.
    if (commit && command !== "COMMIT") {
      return {
        rejection: { error: new Error("Transaction was rolled back: a statement in it failed") },
      }
    }
    return {}
  } catch (error) {
    return { rejection: { error }, failure: { error } }
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

/** Closes a nested level whose `SAVEPOINT` failed, freeing its parent for other statements. */
function closeStarting(level: TransactionLevel): void {
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

/** Error of a level that another level ended, keeping the rejection of its callback as the cause. */
function createClosedError(level: TransactionLevel, rejection: Rejection | undefined): Error {
  return new Error(
    level.endedBy === "preemption"
      ? "Transaction was rolled back: its test fixture started another level before it finished"
      : "Transaction was rolled back: its enclosing transaction ended first",
    rejection && { cause: rejection.error },
  )
}

/** Outcome of a level that something other than its callback ended: a rejection with `error`, which a failed cleanup suppresses. */
export async function getEndedOutcome(cleanup: Promise<Cleanup>, error: unknown): Promise<Cleanup> {
  const ended = await cleanup
  return { rejection: combineRejections({ error }, ended), failure: ended.failure }
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
