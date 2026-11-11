// Test helpers that wait until a backend of PostgreSQL waits for a lock, such as to check that a statement blocks on a row or an advisory lock that another test transaction holds.
import type { Connection } from "./driver"
import { createStatement } from "./driver"
import { pause } from "./transaction/advisory-lock"

/** Options of `waitForLock` and `waitForLockedStatement`. */
export interface LockWaitOptions {
  /** Milliseconds to wait before rejecting; 2000 by default, shorter than the default timeout of a test, so that the helper rejects with its own error. */
  timeout?: number
}

/** Time that the helpers wait by default, in milliseconds. */
const defaultTimeout = 2000

/** Pause between two checks in milliseconds, so that waiting does not keep the observer busy. */
const pollInterval = 5

/**
 * Resolves to the process ID of the backend of PostgreSQL that runs the statements of `target`, `pg_backend_pid()`.
 *
 * Call it on the connection that will wait for a lock, such as inside its transaction or session: on the pool of a database or a driver, it gives the backend of whichever connection runs the statement.
 */
export async function getBackendPid(target: Pick<Connection, "execute">): Promise<number> {
  const { rows } = await target.execute(createStatement("SELECT pg_backend_pid()"))
  return Number(rows[0]![0])
}

/**
 * Waits until the backend `pid` waits for a lock, such as of a row or an advisory lock that another transaction holds, and rejects when it does not in time.
 *
 * `observer` runs the checks: a database, a driver, or a connection other than the one that waits.
 * It reads the locks with `pg_blocking_pids`, which reads the current lock state even inside a transaction.
 */
export async function waitForLock(
  observer: Pick<Connection, "execute">,
  pid: number,
  options: LockWaitOptions = {},
): Promise<void> {
  const timeout = options.timeout ?? defaultTimeout
  const statement = createStatement("SELECT cardinality(pg_blocking_pids($1::integer)) > 0", [
    String(pid),
  ])
  await poll(timeout, `Backend ${pid} did not wait for a lock within ${timeout} ms`, async () => {
    const { rows } = await observer.execute(statement)
    return rows[0]![0] === "t" ? true : undefined
  })
}

/**
 * Waits until a backend of the current database other than that of `observer` waits for a lock in a statement whose text contains `fragment`, and resolves to its backend PID.
 *
 * It finds a backend that the test does not know, such as one of the pool of the code under test.
 * `observer` runs the checks: a database, a driver, or a connection other than the one that waits.
 * It rejects when no such backend waits in time.
 */
export async function waitForLockedStatement(
  observer: Pick<Connection, "execute">,
  fragment: string,
  options: LockWaitOptions = {},
): Promise<number> {
  const timeout = options.timeout ?? defaultTimeout
  // `pg_stat_activity` keeps the snapshot of its first read until the transaction ends, so a check in a transaction clears it to see the backends that started waiting since.
  const clearSnapshot = createStatement("SELECT pg_stat_clear_snapshot()")
  const statement = createStatement(
    `SELECT pid FROM pg_stat_activity
    WHERE datname = current_database() AND pid <> pg_backend_pid()
      AND position($1::text IN query) > 0 AND cardinality(pg_blocking_pids(pid)) > 0
    ORDER BY pid LIMIT 1`,
    [fragment],
  )
  return await poll(
    timeout,
    `No statement with "${fragment}" waited for a lock within ${timeout} ms`,
    async isWaiting => {
      await observer.execute(clearSnapshot)
      // The helper may have rejected meanwhile, after which the caller may have released the observer.
      if (!isWaiting()) {
        return undefined
      }
      const { rows } = await observer.execute(statement)
      return rows.length > 0 ? Number(rows[0]![0]) : undefined
    },
  )
}

/**
 * Calls `check` until it resolves to a value other than `undefined`, pausing between the calls, and resolves to that value.
 *
 * It rejects with `message` once `timeout` passes, also while a check still runs, such as on a pool that has no free connection; such a check settles without the helper.
 * A check must send no further statement once `isWaiting` returns `false`.
 */
async function poll<T>(
  timeout: number,
  message: string,
  check: (isWaiting: () => boolean) => Promise<T | undefined>,
): Promise<T> {
  let waiting = true
  const isWaiting = () => waiting
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      waiting = false
      reject(new Error(message))
    }, timeout)
  })
  try {
    for (;;) {
      const value = await Promise.race([check(isWaiting), expired])
      if (value !== undefined) {
        return value
      }
      await Promise.race([pause(pollInterval, undefined), expired])
    }
  } finally {
    waiting = false
    clearTimeout(timer)
  }
}
