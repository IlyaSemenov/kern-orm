// Waiting for concurrent operations in the tests of the migrator, such as for a transaction that waits for a lock.
import type { Database } from "kern-db"
import * as t from "kern-db/types"

/** Counts the transactions that wait for the advisory lock of `hashtextextended(key, 0)`, such as of key `"tenant"."kern_migration"`, which locks the target in schema `tenant`. */
export async function countLockWaiters(database: Database, key: string): Promise<number> {
  // PostgreSQL shows a lock of a bigint key as its high and low 32 bits, which 0xFFFFFFFF masks.
  return await database.query`
    SELECT count(*)::integer FROM pg_locks, (SELECT hashtextextended(${key}, 0) AS key) AS lock
    WHERE locktype = 'advisory' AND NOT granted
      AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND classid = ((lock.key >> 32) & 0xFFFFFFFF)::oid AND objid = (lock.key & 0xFFFFFFFF)::oid
  `.get(t.integer)
}

/** Time that a test waits for a concurrent operation, shorter than the timeout of a test, so that the test cleans up after a failure. */
const waitTimeout = 2000

/** Waits until `condition` holds, checking it every 10 milliseconds, and rejects when it does not hold in time. */
export async function waitFor(condition: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + waitTimeout
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error("The condition did not hold in time")
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

/** Resolves to the result of `operation`, and rejects when it does not settle in time. */
export async function settleWithin<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The operation did not settle in time")), waitTimeout)
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    clearTimeout(timer)
  }
}
