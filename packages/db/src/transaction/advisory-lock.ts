// Advisory locks of string keys: the statements that take them in a transaction and in a session, the locks that a session holds until it ends, and polling for one in a session.

import type { Connection, DriverResult, SqlStatement } from "../driver"
import { createStatement } from "../driver"
import { formatArray } from "../type/builtins/array"
import { decodeBoolean } from "../type/builtins/boolean"

/** Pause of `pollLock` in milliseconds after its first attempt, which doubles after each attempt up to `maxPollDelay`. */
const firstPollDelay = 50
/** Longest pause of `pollLock` in milliseconds. */
const maxPollDelay = 1000

/** Creates the statement that takes the transaction-level advisory lock of `key`, waiting while another transaction or session holds it. */
export function createLockStatement(key: string): SqlStatement {
  return createStatement("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key])
}

/** Creates the statement that takes the transaction-level advisory lock of `key` unless another transaction or session holds it, see `isTaken`. */
export function createTryLockStatement(key: string): SqlStatement {
  return createStatement("SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0))", [key])
}

/** Tells whether the statement that tried to take a lock took it. */
export function isTaken(result: DriverResult): boolean {
  return decodeBoolean(result.rows[0]![0]!)
}

/**
 * Calls `tryLock` until it takes the lock, with `wait` pausing between the attempts, and rejects with the reason of `signal` once it aborts.
 *
 * An attempt that runs when `signal` aborts is awaited, and if it takes the lock, the call resolves, since the session holds the lock until it ends.
 * `wait` is `pause`, which a test replaces to observe the pauses without a clock.
 */
export async function pollLock(
  tryLock: () => Promise<boolean>,
  signal: AbortSignal | undefined,
  wait: (delay: number, signal: AbortSignal | undefined) => Promise<void> = pause,
): Promise<void> {
  signal?.throwIfAborted()
  let delay = firstPollDelay
  while (!(await tryLock())) {
    // A listener added to a signal that has aborted is never called.
    signal?.throwIfAborted()
    await wait(delay, signal)
    delay = Math.min(delay * 2, maxPollDelay)
  }
}

/** Waits `delay` milliseconds, or rejects with the reason of `signal` once it aborts, clearing the timer so that it keeps no process alive. */
export function pause(delay: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal!.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, delay)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

/**
 * Advisory locks that a session takes with `tryLock` until it ends.
 *
 * PostgreSQL holds a lock of a session until `pg_advisory_unlock` releases it as many times as the session took it, so the session takes each key once, and one `pg_advisory_unlock` of each key releases it.
 */
export class SessionLocks {
  /** Attempt of each key that the session holds or is taking; an attempt that does not take its lock leaves it. */
  readonly #attempts = new Map<string, Promise<boolean>>()
  /** Whether a statement of an attempt failed: PostgreSQL keeps a lock of a session that it took after the statement fails, so whether the connection holds it is unknown. */
  #failed = false

  /** Takes the lock of `key` on `connection` unless another session or transaction holds it, and tells whether it took it; a key that the session holds or is taking returns that attempt without a statement. */
  take(connection: Connection, key: string): Promise<boolean> {
    const current = this.#attempts.get(key)
    if (current) {
      return current
    }
    const attempt = connection
      .execute(createStatement("SELECT pg_try_advisory_lock(hashtextextended($1, 0))", [key]))
      .then(
        result => {
          const taken = isTaken(result)
          if (!taken) {
            this.#attempts.delete(key)
          }
          return taken
        },
        (error: unknown) => {
          this.#failed = true
          this.#attempts.delete(key)
          throw error
        },
      )
    this.#attempts.set(key, attempt)
    return attempt
  }

  /**
   * Waits for the attempts in progress and returns the keys of the locks that the session holds, or `undefined` when a statement of an attempt failed, so that it is unknown which locks the connection holds.
   *
   * An attempt that the callback of the session did not await is sent before the session ends, so waiting for it does not wait for the session.
   */
  async settle(): Promise<string[] | undefined> {
    await Promise.allSettled(this.#attempts.values())
    return this.#failed ? undefined : [...this.#attempts.keys()]
  }
}

/**
 * Creates the statement that releases the locks of a session of `keys`, once each, see `SessionLocks`.
 *
 * It takes the keys as one array and releases them in rows, since PostgreSQL limits the columns of a result to 1664.
 */
export function createUnlockStatement(keys: string[]): SqlStatement {
  return createStatement(
    "SELECT pg_advisory_unlock(hashtextextended(key, 0)) FROM unnest($1::text[]) AS key",
    [formatArray(keys, key => key)],
  )
}
