// Waiting for a promise unless the abort signal of a test aborts first, for the levels and connections of test transactions.

import type { Connection, Driver } from "../driver"

/**
 * Runs `start` and settles as its promise, or rejects with the reason of `signal` when it aborts first and `abort`, called on the abort, returns `true`.
 *
 * It listens from before `start`, which may abort the signal before it returns, and stops once the promise of `start` settles, such as for the signal that `node:test` aborts after every test.
 * A later rejection of that promise stays handled, and a value it resolves with after the rejection goes to `discard`, which handles its own failures.
 */
export function settleUnlessAborted<T>(
  start: () => Promise<T>,
  signal: AbortSignal,
  abort: () => boolean,
  discard?: (value: T) => void,
): Promise<T> {
  const settled = Promise.withResolvers<T>()
  let abandoned = false
  const onAbort = () => {
    if (abort()) {
      abandoned = true
      settled.reject(signal.reason)
    }
  }
  signal.addEventListener("abort", onAbort, { once: true })
  let running: Promise<T>
  try {
    running = start()
  } catch (error) {
    signal.removeEventListener("abort", onAbort)
    settled.reject(error)
    return settled.promise
  }
  // Subscribing to the promise of `start` itself, rather than to one that adopts it, and stopping to listen in the job that settles, keeps an abort that comes after it settles from acting on it.
  void running.then(
    value => {
      signal.removeEventListener("abort", onAbort)
      if (abandoned) {
        discard?.(value)
      } else {
        settled.resolve(value)
      }
    },
    (error: unknown) => {
      signal.removeEventListener("abort", onAbort)
      settled.reject(error)
    },
  )
  return settled.promise
}

/**
 * Acquires a connection for a test transaction, rejecting with the reason of `signal` when it aborts first.
 *
 * A connection acquired after the abort returns to the pool as best-effort cleanup: the test transaction has already rejected, so nothing awaits the release, and its failure is ignored.
 */
export function acquireUnlessAborted(driver: Driver, signal: AbortSignal): Promise<Connection> {
  if (signal.aborted) {
    return Promise.reject(signal.reason)
  }
  return settleUnlessAborted(
    () => driver.acquire(),
    signal,
    () => true,
    connection => {
      Promise.resolve()
        .then(() => connection.release())
        .catch(() => {})
    },
  )
}
