import { describe, expect, it } from "bun:test"

import type { SqlStatement } from "kern-orm"
import { QueryError } from "kern-orm"

import { createRecordingDriver } from "../../../testing/recording-driver"

import { pause, pollLock } from "./advisory-lock"
import { TransactionCoordinator } from "./coordinator"
import { createTestCoordinator, holdOn, markHandled } from "./testing"

const lockStatement = "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))"
const tryLockStatement = "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0))"
const trySessionLockStatement = "SELECT pg_try_advisory_lock(hashtextextended($1, 0))"
const unlockStatement =
  "SELECT pg_advisory_unlock(hashtextextended(key, 0)) FROM unnest($1::text[]) AS key"
const readSetting = "SELECT current_setting($1)"
const setSetting = "SELECT set_config($1, $2, false)"

/** Response that awaits `respond`, such as of `holdOn`, for every statement, takes every lock except those of `busy` keys, and answers reading a setting. */
function respondWithLocks(
  respond: (statement: SqlStatement) => unknown = () => {},
  busy: ReadonlySet<unknown> = new Set(),
) {
  return async (statement: SqlStatement) => {
    await respond(statement)
    if (statement.text === readSetting) {
      return { rows: [['"$user", public']] }
    }
    return statement.text.startsWith("SELECT pg_try_advisory")
      ? { rows: [[busy.has(statement.parameters[0]) ? "f" : "t"]] }
      : {}
  }
}

describe("where a lock cannot be taken", () => {
  it("rejects lock and tryLock outside a transaction, also in a test transaction, without a statement", async () => {
    const { coordinator, statements } = createTestCoordinator()
    const lockMessage =
      "Cannot take an advisory lock outside a transaction, where it would end with its statement; a test transaction alone does not count"
    const tryLockMessage =
      "Cannot take an advisory lock outside a transaction or a session, where it would end with its statement; a test transaction alone does not count"

    await expect(coordinator.lock("import")).rejects.toThrow(lockMessage)
    await expect(coordinator.tryLock("import")).rejects.toThrow(tryLockMessage)
    await coordinator.testTransaction(async () => {
      await expect(coordinator.lock("import")).rejects.toThrow(lockMessage)
      await expect(coordinator.tryLock("import")).rejects.toThrow(tryLockMessage)
    })

    expect(statements.map(({ text }) => text)).toEqual(["BEGIN", "ROLLBACK"])
  })

  it("rejects lock in a session outside its transactions without a statement, naming tryLock", async () => {
    const { driver, statements } = createRecordingDriver()
    const coordinator = new TransactionCoordinator(driver)

    await coordinator.session(async () => {
      await expect(coordinator.lock("import")).rejects.toThrow(
        "Cannot wait for an advisory lock in a session outside a transaction: the waiting statement would keep a snapshot that CREATE INDEX CONCURRENTLY in the session holding the lock waits for; take it with tryLock, which does not wait",
      )
    })

    expect(statements).toEqual([])
  })

  it("rejects pollLock outside a session and in a transaction, also of a session or a test transaction, without a statement", async () => {
    const { driver, statements } = createRecordingDriver()
    const coordinator = new TransactionCoordinator(driver)
    const { coordinator: testCoordinator } = createTestCoordinator()
    const inTransaction =
      "Cannot poll for an advisory lock in a transaction, which would keep a snapshot between the attempts; take it with lock, which waits for it"

    await expect(coordinator.pollLock("import")).rejects.toThrow(
      "Cannot poll for an advisory lock outside a session, where it would end with its statement",
    )
    await coordinator.transaction(async () => {
      await expect(coordinator.pollLock("import")).rejects.toThrow(inTransaction)
    })
    await coordinator.session(() =>
      coordinator.transaction(async () => {
        await expect(coordinator.pollLock("import")).rejects.toThrow(inTransaction)
      }),
    )
    await testCoordinator.testTransaction(async () => {
      await expect(testCoordinator.pollLock("import")).rejects.toThrow(
        "Cannot poll for an advisory lock in a test transaction, which would keep a snapshot between the attempts; take it with lock inside transaction or ensureTransaction",
      )
    })

    expect(statements.map(({ text }) => text)).toEqual(["BEGIN", "COMMIT", "BEGIN", "COMMIT"])
  })
})

it("takes the locks of a transaction in a transaction of a session, which the session does not release", async () => {
  const { driver, statements } = createRecordingDriver({
    respond: respondWithLocks(undefined, new Set(["export"])),
  })
  const coordinator = new TransactionCoordinator(driver)

  const taken = await coordinator.session(() =>
    coordinator.transaction(async () => {
      await coordinator.lock("import")
      return [await coordinator.tryLock("import"), await coordinator.tryLock("export")]
    }),
  )

  expect(taken).toEqual([true, false])
  expect(statements).toEqual([
    { connection: 1, text: "BEGIN", parameters: [] },
    { connection: 1, text: lockStatement, parameters: ["import"] },
    { connection: 1, text: tryLockStatement, parameters: ["import"] },
    { connection: 1, text: tryLockStatement, parameters: ["export"] },
    { connection: 1, text: "COMMIT", parameters: [] },
  ])
})

describe("locks of a session", () => {
  it("takes a key once for repeated and concurrent calls, tries a key that it did not take again, and releases each lock it took once before restoring its settings", async () => {
    const busy = new Set(["export"])
    const events: string[] = []
    const { driver, statements } = createRecordingDriver({
      respond: respondWithLocks(statement => {
        events.push(statement.text)
      }, busy),
      release() {
        events.push("release")
      },
    })
    const coordinator = new TransactionCoordinator(driver)

    const taken = await coordinator.session(
      async () => {
        const concurrent = await Promise.all([
          coordinator.tryLock("import"),
          coordinator.tryLock("import"),
        ])
        const repeated = await coordinator.tryLock("import")
        const busyExport = await coordinator.tryLock("export")
        busy.clear()
        const freeExport = await coordinator.tryLock("export")
        return [
          ...concurrent,
          repeated,
          busyExport,
          freeExport,
          await coordinator.tryLock("export"),
        ]
      },
      { searchPath: ["tenant_1"] },
    )

    expect(taken).toEqual([true, true, true, false, true, true])
    expect(statements.slice(2)).toEqual([
      { connection: 1, text: trySessionLockStatement, parameters: ["import"] },
      { connection: 1, text: trySessionLockStatement, parameters: ["export"] },
      { connection: 1, text: trySessionLockStatement, parameters: ["export"] },
      { connection: 1, text: unlockStatement, parameters: ['{"import","export"}'] },
      { connection: 1, text: setSetting, parameters: ["search_path", '"$user", public'] },
    ])
    expect(events.slice(-2)).toEqual([setSetting, "release"])
  })

  it("releases no locks when it took none", async () => {
    const { driver, statements } = createRecordingDriver({
      respond: respondWithLocks(undefined, new Set(["import"])),
    })
    const coordinator = new TransactionCoordinator(driver)

    await coordinator.session(() => coordinator.tryLock("import"))

    expect(statements.map(({ text }) => text)).toEqual([trySessionLockStatement])
  })

  it("waits for an attempt that the callback did not await, and releases the lock it takes", async () => {
    const attempt = holdOn(trySessionLockStatement)
    const { driver, statements, releases } = createRecordingDriver({
      respond: respondWithLocks(attempt.respond),
    })
    const coordinator = new TransactionCoordinator(driver)

    let taken: Promise<boolean> | undefined
    const session = coordinator.session(async () => {
      taken = markHandled(coordinator.tryLock("import"))
    })
    await attempt.reached
    expect(releases).toEqual([])
    attempt.resume()
    await session

    expect(await taken!).toBe(true)
    expect(statements).toMatchObject([
      { text: trySessionLockStatement, parameters: ["import"] },
      { text: unlockStatement, parameters: ['{"import"}'] },
    ])
    expect(releases).toEqual([{ connection: 1 }])
  })

  it("rejects tryLock while a transaction of the session runs and after the session ends, without a statement", async () => {
    const begin = holdOn("BEGIN")
    const { driver, statements } = createRecordingDriver({ respond: begin.respond })
    const coordinator = new TransactionCoordinator(driver)
    const { promise: finished, resolve: finish } = Promise.withResolvers<void>()

    let late: Promise<unknown> | undefined
    await coordinator.session(async () => {
      late = markHandled(finished.then(() => coordinator.tryLock("import")))
      const transaction = coordinator.transaction(() => Promise.resolve())
      await begin.reached
      await expect(coordinator.tryLock("import")).rejects.toThrow(
        "Cannot take an advisory lock: a transaction of the session is running; await it first",
      )
      begin.resume()
      await transaction
    })
    finish()

    await expect(late!).rejects.toThrow(
      "Cannot take an advisory lock: its session is already finished",
    )
    expect(statements.map(({ text }) => text)).toEqual(["BEGIN", "COMMIT"])
  })

  it("leaves the connection in a transaction instead of releasing its locks and restoring its settings after a failed statement of tryLock, which may have taken its lock", async () => {
    const rejected = new QueryError("canceled", { code: "57014" })
    const reported: unknown[] = []
    const events: string[] = []
    const { driver } = createRecordingDriver({
      respond: respondWithLocks(statement => {
        events.push(statement.text)
        if (statement.parameters[0] === "export") {
          throw rejected
        }
      }),
      release() {
        events.push("release")
      },
    })
    const coordinator = new TransactionCoordinator(driver, {
      onReleaseError: error => reported.push(error),
    })

    const result = await coordinator.session(
      async () => {
        await coordinator.tryLock("import")
        await expect(coordinator.tryLock("export")).rejects.toBe(rejected)
        return "done"
      },
      { searchPath: ["tenant_1"] },
    )

    expect(result).toBe("done")
    expect(events).toEqual([
      readSetting,
      setSetting,
      trySessionLockStatement,
      trySessionLockStatement,
      "BEGIN",
      "release",
    ])
    expect(reported).toEqual([])
  })

  it("leaves the connection in a transaction instead of restoring its settings when releasing its locks fails, reports the failure, and keeps the result", async () => {
    const rejected = new QueryError("canceled", { code: "57014" })
    const reported: unknown[] = []
    const events: string[] = []
    const { driver } = createRecordingDriver({
      respond: respondWithLocks(statement => {
        events.push(statement.text)
        if (statement.text === unlockStatement) {
          throw rejected
        }
      }),
      release() {
        events.push("release")
      },
    })
    const coordinator = new TransactionCoordinator(driver, {
      onReleaseError: error => reported.push(error),
    })

    const result = await coordinator.session(
      async () => {
        await coordinator.tryLock("import")
        return "done"
      },
      { searchPath: ["tenant_1"] },
    )

    expect(result).toBe("done")
    expect(events).toEqual([
      readSetting,
      setSetting,
      trySessionLockStatement,
      unlockStatement,
      "BEGIN",
      "release",
    ])
    expect(reported).toHaveLength(1)
    expect(reported[0]).toMatchObject({
      message: "Releasing the advisory locks of a session failed",
      cause: rejected,
    })
  })
})

describe("polling in a session", () => {
  /** Polls with `tryLock` and a wait that records its pauses and ends each at once, or rejects as `pause` once the signal it is given has aborted. */
  function poll(tryLock: () => Promise<boolean>, signal?: AbortSignal) {
    const delays: number[] = []
    const polled = pollLock(tryLock, signal, (delay, waitSignal) => {
      delays.push(delay)
      return waitSignal?.aborted ? Promise.reject(waitSignal.reason) : Promise.resolve()
    })
    return { polled, delays }
  }

  it("pauses for 50 ms after the first attempt that does not take the lock, doubling the pause after each attempt up to a second", async () => {
    let attempts = 0

    const { polled, delays } = poll(() => Promise.resolve(++attempts === 8))
    await polled

    expect(delays).toEqual([50, 100, 200, 400, 800, 1000, 1000])
  })

  it("rejects with the reason of an aborted signal without an attempt", async () => {
    const reason = new Error("timeout")
    let attempts = 0

    const { polled } = poll(() => Promise.resolve(++attempts > 0), AbortSignal.abort(reason))

    await expect(polled).rejects.toBe(reason)
    expect(attempts).toBe(0)
  })

  it("rejects without a pause when the signal aborts during an attempt that does not take the lock", async () => {
    const reason = new Error("timeout")
    const controller = new AbortController()

    const { polled, delays } = poll(() => {
      controller.abort(reason)
      return Promise.resolve(false)
    }, controller.signal)

    await expect(polled).rejects.toBe(reason)
    expect(delays).toEqual([])
  })

  it("resolves when the signal aborts during an attempt that takes the lock", async () => {
    const controller = new AbortController()

    const { polled } = poll(() => {
      controller.abort(new Error("timeout"))
      return Promise.resolve(true)
    }, controller.signal)

    await expect(polled).resolves.toBeUndefined()
  })

  it("rejects at once without another attempt when the signal aborts during a pause", async () => {
    const reason = new Error("timeout")
    const controller = new AbortController()
    const paused = Promise.withResolvers<void>()
    let attempts = 0

    const polled = pollLock(
      () => Promise.resolve(++attempts > 1),
      controller.signal,
      (_delay, signal) => {
        paused.resolve()
        // A pause that did not get the signal, or ignored it, would outlast the timeout of the test.
        return pause(60_000, signal)
      },
    ).catch((error: unknown) => error)
    await paused.promise
    controller.abort(reason)

    expect(await polled).toBe(reason)
    expect(attempts).toBe(1)
  })

  it("tries the lock in a session again after a pause until it takes it, and releases it once when the session ends", async () => {
    const busy = new Set(["import"])
    let attempts = 0
    const { driver, statements } = createRecordingDriver({
      respond: respondWithLocks(statement => {
        if (statement.text === trySessionLockStatement && ++attempts === 3) {
          busy.clear()
        }
      }, busy),
    })
    const coordinator = new TransactionCoordinator(driver)

    await coordinator.session(() => coordinator.pollLock("import"))

    expect(statements.map(({ text }) => text)).toEqual([
      trySessionLockStatement,
      trySessionLockStatement,
      trySessionLockStatement,
      unlockStatement,
    ])
  })
})
