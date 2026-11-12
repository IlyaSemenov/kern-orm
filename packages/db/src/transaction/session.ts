// Sessions: levels that run statements on a reserved connection outside a transaction, and how their connection returns to the pool without their advisory locks and settings.

import type { Connection, SqlStatement } from "../driver"
import { createStatement } from "../driver"
import { ConnectionError, QueryError } from "../driver-error"
import { isQueryError } from "../error-condition"

import { createUnlockStatement } from "./advisory-lock"
import { ConnectionWatch } from "./connection-loss"
import type { TransactionLevel } from "./level"
import type { ReleaseErrorHandler } from "./release"
import { releaseConnection, reportReleaseError } from "./release"

const beginStatement = /* @__PURE__ */ createStatement("BEGIN")

/**
 * Creates the state of a `starting` session on `connection`.
 *
 * It watches its connection for a `ConnectionError`, after which it accepts no statements: the connection may be lost, and a statement that a client ran on a new connection would run without the settings of the session.
 */
export function createSessionLevel(connection: Connection): TransactionLevel {
  const watch = new ConnectionWatch(connection)
  return {
    connection: watch,
    watch,
    parent: undefined,
    depth: 0,
    session: true,
    savepoint: false,
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
