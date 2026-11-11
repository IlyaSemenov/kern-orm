// PostgreSQL of the tests of the ORM at `DATABASE_URL`, such as from `.env.test.local`; the tests that need it are skipped without it.
import type { AnyDb } from "kern-orm"
import { getBackendPid, waitForLock } from "kern-orm/testing"

export { describePooledPostgres, describePostgres } from "@kern-orm/test-harness/postgres"

/**
 * Runs `callback` while a transaction of `db` holds what `statement` takes, with what it gives, and commits it at the latest when `callback` ends.
 *
 * `callback` runs outside the transaction, on connections of its own, and can commit it earlier.
 */
export async function whileHolding<H>(
  db: AnyDb,
  statement: () => PromiseLike<H>,
  callback: (held: H, commit: () => Promise<void>) => Promise<void>,
): Promise<void> {
  const held = Promise.withResolvers<H>()
  const release = Promise.withResolvers<void>()
  const transaction = db.$transaction(async () => {
    held.resolve(await statement())
    await release.promise
  })
  const value = await Promise.race([held.promise, transaction.then(() => held.promise)])
  const commit = () => {
    release.resolve()
    return transaction
  }
  try {
    await callback(value, commit)
  } finally {
    await commit()
  }
}

/** Starts a transaction of `db` that runs `statement` and returns once `statement` waits for a lock, with the backend of the transaction and the promise of what it gives after the wait. */
export async function startWaiting<T>(
  db: AnyDb,
  statement: () => PromiseLike<T>,
): Promise<{ pid: number; result: Promise<T> }> {
  const backend = Promise.withResolvers<number>()
  const result = db.$transaction(async () => {
    backend.resolve(await getBackendPid(db.$database))
    return await statement()
  })
  // It rejects the test if the transaction fails before it reads its backend.
  const pid = await Promise.race([backend.promise, result.then(() => backend.promise)])
  const waited = await Promise.race([
    waitForLock(db.$database, pid).then(() => true),
    // It rejects the test if the transaction fails before the statement waits.
    result.then(() => false),
  ])
  if (!waited) {
    throw new Error("The statement did not wait for a lock")
  }
  return { pid, result }
}
