// Returning reserved connections to the driver at the end of a transaction, so that a failed release never changes the result or error of the transaction.

import type { Connection, TransactionFailure } from "../driver"

/** Receives a failure to return a connection to the driver, see `onReleaseError` of `createDatabase`. */
export type ReleaseErrorHandler = (error: unknown) => void

/**
 * Returns a connection to the driver and passes a failed release to `onReleaseError`, or to `console.error` without one.
 *
 * The result or error of the transaction is decided before its release, so a failed release must not change it: a committed transaction that rejected would be retried.
 * Reporting the failure cannot change it either.
 * The error of a handler that throws or rejects goes to `console.error` with the failure of the release, and a `console.error` that throws is ignored.
 */
export async function releaseConnection(
  connection: Connection,
  failure: TransactionFailure | undefined,
  onReleaseError: ReleaseErrorHandler | undefined,
): Promise<void> {
  try {
    // A failed BEGIN, COMMIT, or ROLLBACK may leave the transaction open; the driver decides whether the connection can return to the pool.
    await connection.release(failure)
  } catch (error) {
    reportReleaseError(error, onReleaseError)
  }
}

/** Passes a failed release to `onReleaseError`, or to `console.error` without one, without throwing. */
function reportReleaseError(error: unknown, onReleaseError: ReleaseErrorHandler | undefined): void {
  if (!onReleaseError) {
    logReleaseError(error)
    return
  }
  try {
    // The type of the option accepts an async function, whose rejection would otherwise be unhandled.
    // `Promise.resolve` adopts any thenable, including a promise of another realm, such as of `node:vm`, which `instanceof Promise` misses.
    // The handler is not awaited, so a slow one does not delay the transaction.
    Promise.resolve(onReleaseError(error)).catch((handlerError: unknown) =>
      logReleaseError(error, { error: handlerError }),
    )
  } catch (handlerError) {
    logReleaseError(error, { error: handlerError })
  }
}

/**
 * Writes a failed release to `console.error`, preceded by the error of `onReleaseError` when the handler failed.
 *
 * A console that throws, such as one redirected to a failing logger, leaves nowhere to report to, so its error is ignored.
 */
function logReleaseError(error: unknown, handlerFailure?: { readonly error: unknown }): void {
  try {
    if (handlerFailure) {
      console.error("kern-orm: onReleaseError failed", handlerFailure.error)
    }
    console.error("kern-orm: releasing a connection failed", error)
  } catch {
    // Nothing is left to report to.
  }
}
