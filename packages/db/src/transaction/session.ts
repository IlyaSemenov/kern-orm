// Sessions: levels that run statements on a reserved connection outside a transaction, how they start, the open sessions that the callbacks of `run` share, and how their connection returns to the pool without their advisory locks and settings.

import { AsyncLocalStorage } from "node:async_hooks"

import type { OpenedSession } from "../database"
import type { Connection, DriverResult, SqlStatement } from "../driver"
import { createStatement } from "../driver"
import { ConnectionError, QueryError } from "../driver-error"
import { isQueryError } from "../error-condition"

import { createUnlockStatement } from "./advisory-lock"
import { ConnectionWatch } from "./connection-loss"
import type { TransactionLevel } from "./level"
import { createUnavailableError, endLevel } from "./level"
import type { ReleaseErrorHandler } from "./release"
import { releaseConnection, reportReleaseError } from "./release"
import type { LevelSetting } from "./settings"
import { applySettings } from "./settings"

const beginStatement = /* @__PURE__ */ createStatement("BEGIN")

/** Call of `run` of an open session, which the async context of its callback carries, so that the session tells a callback that is running from late code of one that settled. */
interface SessionRun {
  /** Level of the session of the call. */
  readonly level: TransactionLevel
  /** Whether the promise that `run` returned is pending. */
  active: boolean
}

/**
 * The calls of `run` of the async context, outermost first, of the open sessions of every database, whose coordinators have async contexts of their own.
 *
 * Of each session, it has the innermost call, which tells a running callback from late code of one that settled, and the calls around it that were running when the innermost call of the context started, which closing must not wait inside.
 * It has no other call that settled, and a call refers to no other call, so that a session that runs for long does not keep the calls that settled.
 */
const sessionRuns = /* @__PURE__ */ new AsyncLocalStorage<readonly SessionRun[]>()

/** Tells whether the innermost call of the session of `level` in the async context is running, so that the code there is a part of a running callback rather than late code of one that settled. */
function isInnermostCallRunning(level: TransactionLevel): boolean {
  const calls = sessionRuns.getStore()
  if (calls) {
    for (let index = calls.length - 1; index >= 0; index--) {
      const call = calls[index]!
      if (call.level === level) {
        return call.active
      }
    }
  }
  return false
}

/** Tells whether a call of the session of `level` that is running encloses the async context, also around a call that settled, so that waiting there for the calls to settle would wait for itself. */
function hasRunningEnclosingCall(level: TransactionLevel): boolean {
  const calls = sessionRuns.getStore()
  return calls !== undefined && calls.some(call => call.level === level && call.active)
}

/**
 * Returns the calls of the async context of the callback of `call`: those of the async context of its caller that are running, and the innermost calls of the other open sessions that settled, followed by `call`.
 *
 * A call that settled tells late code only as the innermost call of its session, which `call` is for its own.
 */
function createCallContext(call: SessionRun): SessionRun[] {
  const calls: SessionRun[] = []
  const enclosing = sessionRuns.getStore()
  if (enclosing) {
    for (let index = 0; index < enclosing.length; index++) {
      const other = enclosing[index]!
      if (
        other.active ||
        (other.level !== call.level &&
          // A session that ended tells nothing more, and code that opens a session after another, such as after a lost connection, must not collect its calls.
          other.level.state !== "closed" &&
          !enclosing.some((later, position) => position > index && later.level === other.level))
      ) {
        calls.push(other)
      }
    }
  }
  calls.push(call)
  return calls
}

/**
 * Creates the state of a `starting` session on the connection of `watch`.
 *
 * It watches its connection for a `ConnectionError`, after which it accepts no statements: the connection may be lost, and a statement that a client ran on a new connection would run without the settings of the session.
 */
function createSessionLevel(watch: ConnectionWatch): TransactionLevel {
  return {
    connection: watch,
    watch,
    parent: undefined,
    depth: 0,
    session: true,
    savepoint: false,
    external: false,
    inTransaction: false,
    state: "starting",
    child: undefined,
    rollbackOnly: undefined,
    cleanup: undefined,
    endedBy: undefined,
    restore: undefined,
    isolation: undefined,
    locks: undefined,
    turns: undefined,
  }
}

/**
 * Starts a session with `settings` on `connection`, and returns its `starting` level.
 *
 * A session whose settings fail to apply rejects with their error after it tried to restore what the failed statement may have set and to release its connection.
 */
export function startSession(
  connection: Connection,
  settings: readonly LevelSetting[] | undefined,
  onReleaseError: ReleaseErrorHandler | undefined,
): Promise<TransactionLevel> {
  return startSessionLevel(new ConnectionWatch(connection), settings, onReleaseError)
}

/** Starts a session with `settings` on the connection of `watch`, see `startSession`. */
async function startSessionLevel(
  watch: ConnectionWatch,
  settings: readonly LevelSetting[] | undefined,
  onReleaseError: ReleaseErrorHandler | undefined,
): Promise<TransactionLevel> {
  const level = createSessionLevel(watch)
  if (settings) {
    try {
      await applySettings(level, settings)
    } catch (error) {
      level.state = "closed"
      await releaseSession(level, onReleaseError)
      throw error
    }
  }
  return level
}

/**
 * Watch of the connection of an open session that also counts its statements and scripts that are running, so that closing the session waits for them.
 *
 * A driver may return from `release` before the statements of the connection complete, as that of postgres.js does.
 */
class OpenSessionConnection extends ConnectionWatch {
  #running = 0
  /** Resolves the wait of `settle`, if any. */
  #onIdle: (() => void) | undefined
  readonly #onSettled = (): void => {
    if (--this.#running === 0) {
      this.#onIdle?.()
      this.#onIdle = undefined
    }
  }

  override execute(statement: SqlStatement): Promise<DriverResult> {
    return this.#count(super.execute(statement))
  }

  override executeScript(text: string): Promise<void> {
    return this.#count(super.executeScript(text))
  }

  #count<T>(running: Promise<T>): Promise<T> {
    this.#running++
    // The caller gets the promise that counts, so that a rejection that nothing handles stays unhandled.
    return running.finally(this.#onSettled)
  }

  /** Waits until no statement or script of the connection is running; closing calls it once, after the session stops accepting them. */
  settle(): Promise<void> {
    return this.#running === 0
      ? Promise.resolve()
      : new Promise(resolve => {
          this.#onIdle = resolve
        })
  }
}

/**
 * Opens a session with `settings` on `connection` for the callbacks of `run`, which share it in `storage` until it is closed.
 *
 * A session whose settings fail to apply rejects as `startSession` does.
 * Closing waits for the calls of `run` that are running, nested ones too, and then ends the session; while it waits, `run` starts only a call nested in a running callback.
 * It rejects only inside a running callback, which it would wait for; otherwise it never rejects, so that it can run in the handling of an error and in a disposal: a failure to end a transaction of the session rejects that transaction, and a failed release goes to `onReleaseError`, see `releaseSession`.
 */
export async function openSession(
  storage: AsyncLocalStorage<TransactionLevel>,
  connection: Connection,
  settings: readonly LevelSetting[] | undefined,
  onReleaseError: ReleaseErrorHandler | undefined,
): Promise<OpenedSession> {
  const watch = new OpenSessionConnection(connection)
  const level = await startSessionLevel(watch, settings, onReleaseError)
  level.state = "open"
  /** Number of the calls of `run` that are running, each until the promise that it returned settles. */
  let running = 0
  /** Ends the session once the last call that a requested closing waits for settles. */
  let onSettled: (() => void) | undefined
  let closing: Promise<void> | undefined
  const close = () => {
    // Checked before a closing that has started is returned, which a callback must not wait for either.
    if (hasRunningEnclosingCall(level)) {
      return Promise.reject(
        new Error(
          "Cannot close an open session inside a running callback of its run: the closing waits for that callback",
        ),
      )
    }
    // The session ends in the same turn as the closing is called or the last call settles, so that nothing runs in it in between, such as the commit of a transaction that no callback awaited.
    closing ??=
      running === 0
        ? endSession(level, watch, onReleaseError)
        : new Promise(resolve => {
            onSettled = () => resolve(endSession(level, watch, onReleaseError))
          })
    return closing
  }
  return {
    async run(callback) {
      const current = storage.getStore()
      // The statements of the callback would leave the level of the caller, and the session rejects them anyway beside a transaction of its own.
      if (current && current !== level) {
        throw new Error(
          `Cannot run a callback of an open session inside ${current.session ? "another session" : "a transaction"}`,
        )
      }
      // While the closing waits, only a running callback starts a call, which the closing then waits for too, also when the callback does not await it.
      if (closing && level.state === "open" && !isInnermostCallRunning(level)) {
        throw new Error("Cannot run a callback: the session is closing")
      }
      // Late code of a closed session must not run its side effects, as joining a level rejects.
      const unavailable = createUnavailableError(level, "run a callback")
      if (unavailable) {
        throw unavailable
      }
      const call: SessionRun = { level, active: true }
      running++
      try {
        return await sessionRuns.run(createCallContext(call), () =>
          current ? callback() : storage.run(level, callback),
        )
      } finally {
        call.active = false
        if (--running === 0) {
          onSettled?.()
        }
      }
    },
    close,
    [Symbol.asyncDispose]: close,
  }
}

/**
 * Ends an open session whose calls of `run` have settled, starting in the turn of its call: it rolls back a transaction of the session that no callback awaited unless its own end has started, waits for its statements that are running, and returns its connection to the driver, see `releaseSession`.
 *
 * The level is `open` until then, so the statements, transactions, and locks of the calls follow the rules of the level while a closing waits for them.
 */
async function endSession(
  level: TransactionLevel,
  watch: OpenSessionConnection,
  onReleaseError: ReleaseErrorHandler | undefined,
): Promise<void> {
  // A failure to end the transaction rejects that transaction, whose call suppresses with it the error of a session that ended first.
  await endLevel(level, false)
  await watch.settle()
  await releaseSession(level, onReleaseError)
}

/**
 * Releases the advisory locks that an ended session took, restores the settings that it changed, and returns its connection to the driver.
 *
 * A connection whose locks fail to release or whose settings fail to restore is left in a transaction, so that the driver closes it rather than returning it to the pool with them, and so is one whose statement of `tryLock` failed, which may hold a lock that the session does not know of.
 * The failure does not change the result or the error of the session, which is decided before.
 * A failed release of the locks or restore of the settings goes to `onReleaseError`, or to `console.error` without one, unless it is a `ConnectionError`, which a lost connection gives, with nothing to restore.
 */
export async function releaseSession(
  level: TransactionLevel,
  onReleaseError: ReleaseErrorHandler | undefined,
): Promise<void> {
  if (!(await restoreSession(level, onReleaseError))) {
    await leaveInTransaction(level.connection)
  }
  await releaseConnection(level.connection, onReleaseError)
}

/**
 * Releases the advisory locks of an ended session and then restores its settings, and tells whether its connection can return to the pool.
 *
 * It sends them also after a `ConnectionError`: a client that refused a statement without sending it keeps the connection, which the driver then returns to the pool.
 */
async function restoreSession(
  level: TransactionLevel,
  onReleaseError: ReleaseErrorHandler | undefined,
): Promise<boolean> {
  const { connection, locks, restore } = level
  if (locks) {
    const keys = await locks.settle()
    if (!keys) {
      // The failure is not reported: its error has rejected the call of `tryLock`.
      return false
    }
    if (
      keys.length > 0 &&
      !(await executeRestoring(
        connection,
        createUnlockStatement(keys),
        "Releasing the advisory locks of a session failed",
        onReleaseError,
      ))
    ) {
      return false
    }
  }
  return (
    !restore ||
    (await executeRestoring(
      connection,
      restore,
      "Restoring the settings of a session failed",
      onReleaseError,
    ))
  )
}

/** Executes a statement that restores the state of the connection of an ended session, and tells whether it completed, reporting a failure other than a `ConnectionError` with `message`. */
async function executeRestoring(
  connection: Connection,
  statement: SqlStatement,
  message: string,
  onReleaseError: ReleaseErrorHandler | undefined,
): Promise<boolean> {
  try {
    await connection.execute(statement)
    return true
  } catch (error) {
    if (!(error instanceof ConnectionError)) {
      reportReleaseError(new Error(message, { cause: error }), onReleaseError)
    }
    return false
  }
}

/**
 * Leaves `connection` in a transaction or failed, so that the driver closes it on release, which the driver contract requires for a connection that is not idle or that failed with a `ConnectionError`.
 *
 * It sends `BEGIN` again while PostgreSQL rejects it and may leave the connection idle, such as when a cancel request hits the statement, since such a connection would return to the pool.
 * A client that refuses `BEGIN` without sending it, with a `ConnectionError`, keeps an idle connection that the driver returns to the pool: kern-db cannot tell that from a lost connection, on which sending `BEGIN` again would never end.
 */
async function leaveInTransaction(connection: Connection): Promise<void> {
  for (;;) {
    try {
      await connection.execute(beginStatement)
      return
    } catch (error) {
      // A failed transaction, such as one that a failed COMMIT left, rejects BEGIN too, and is not idle either.
      if (!(error instanceof QueryError) || isQueryError(error, "in_failed_sql_transaction")) {
        return
      }
    }
  }
}
