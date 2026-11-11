import { describe, expect, it } from "bun:test"

import { describePooledPostgres } from "@kern-orm/test-harness/postgres"

import { getBackendPid, waitForLock, waitForLockedStatement } from "./lock-wait"

describe("waiting for locks on an observer that does not answer", () => {
  // An observer whose statements never complete, such as on a pool that has no free connection.
  const observer = { execute: () => new Promise<never>(() => {}) }

  it("rejects at the timeout while a check still runs", async () => {
    await expect(waitForLock(observer, 1, { timeout: 20 })).rejects.toThrow(
      "Backend 1 did not wait for a lock within 20 ms",
    )
    await expect(waitForLockedStatement(observer, "UPDATE form", { timeout: 20 })).rejects.toThrow(
      'No statement with "UPDATE form" waited for a lock within 20 ms',
    )
  })

  it("sends no statement after the timeout when a check completes late", async () => {
    const late = Promise.withResolvers<void>()
    let calls = 0
    const slow = {
      execute: async () => {
        calls++
        await late.promise
        return { command: "SELECT", count: 1, columns: [], rows: [] }
      },
    }

    await expect(waitForLockedStatement(slow, "UPDATE form", { timeout: 20 })).rejects.toThrow()
    late.resolve()
    // Lets the check that was running continue after the clearing of the snapshot.
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(calls).toBe(1)
  })
})

describePooledPostgres("waiting for locks", ({ database }) => {
  /** Creates a key that no other test locks, since tests of other files may run at once. */
  const createKey = () => `kern_lock_wait_test_${crypto.randomUUID()}`

  /**
   * Holds the advisory lock of `key` in a session until `release`, and starts a transaction that waits for it, with the backend of the transaction.
   *
   * A failure before the transaction reads its backend releases the lock and ends both before it rejects.
   */
  async function startWaiting(key: string) {
    const held = Promise.withResolvers<void>()
    const released = Promise.withResolvers<void>()
    const backend = Promise.withResolvers<number>()
    const holder = database.session(async () => {
      await database.query`SELECT pg_advisory_lock(hashtext(${key}))`
      held.resolve()
      await released.promise
      await database.query`SELECT pg_advisory_unlock(hashtext(${key}))`
    })
    let waiter: Promise<void> | undefined
    const release = async () => {
      released.resolve()
      const [held, waited] = await Promise.allSettled([holder, waiter])
      for (const outcome of [held, waited]) {
        if (outcome.status === "rejected") {
          throw outcome.reason
        }
      }
    }
    try {
      // Each race rejects when its operation fails before the step.
      await Promise.race([held.promise, holder.then(() => held.promise)])
      waiter = database.transaction(async () => {
        backend.resolve(await getBackendPid(database))
        await database.query`SELECT pg_advisory_xact_lock(hashtext(${key}))`
      })
      const pid = await Promise.race([backend.promise, waiter.then(() => backend.promise)])
      return { pid, release }
    } catch (error) {
      // Rethrows the error of the setup once both operations end, whatever their own errors.
      await release().catch(() => {})
      throw error
    }
  }

  it("resolves when the backend of a pid waits for a lock, and to the backend of a statement that waits", async () => {
    const key = createKey()
    const waiting = await startWaiting(key)
    try {
      await waitForLock(database, waiting.pid)
      expect(await waitForLockedStatement(database, "pg_advisory_xact_lock(hashtext(")).toBe(
        waiting.pid,
      )
    } finally {
      await waiting.release()
    }
  })

  it("rejects when the backend does not wait for a lock in time", async () => {
    const pid = await database.transaction(() => getBackendPid(database))

    await expect(waitForLock(database, pid, { timeout: 50 })).rejects.toThrow(
      `Backend ${pid} did not wait for a lock within 50 ms`,
    )
    await expect(
      waitForLockedStatement(database, "kern_lock_wait_test_missing", { timeout: 50 }),
    ).rejects.toThrow(
      'No statement with "kern_lock_wait_test_missing" waited for a lock within 50 ms',
    )
  })

  it("sees a backend that starts waiting after an observer in a transaction read pg_stat_activity", async () => {
    const key = createKey()
    const snapshotTaken = Promise.withResolvers<void>()
    // The callback runs outside the transaction of the observer, whose context the waiting session and transaction must not join.
    const started = snapshotTaken.promise.then(() => startWaiting(key))
    let pids: { found: number; waiting: number } | undefined
    try {
      await database.transaction(async () => {
        // The first read takes the snapshot of pg_stat_activity, which the helper clears before each check.
        await database.query`SELECT count(*) FROM pg_stat_activity`
        snapshotTaken.resolve()
        const waiting = await started
        pids = {
          found: await waitForLockedStatement(database, "pg_advisory_xact_lock(hashtext("),
          waiting: waiting.pid,
        }
      })
    } finally {
      snapshotTaken.resolve()
      await (await started).release()
    }

    expect(pids!.found).toBe(pids!.waiting)
  })
})
