// Advisory locks of string keys: the statements that take them in a transaction and in a session, and the locks that a session holds until it ends.

import { array } from "../../type/builtins/array"
import { boolean } from "../../type/builtins/boolean"
import { text } from "../../type/builtins/text"
import type { Connection, DriverResult, SqlStatement } from "../driver"
import { createStatement } from "../driver"

/** Type of the keys of a session that one statement releases. */
const keysType = /* @__PURE__ */ array(text)

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
  return boolean.decode(result.rows[0]![0]!)
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
    [keysType.encode(keys)],
  )
}
