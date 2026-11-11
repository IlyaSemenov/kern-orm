import { describe, expect, it } from "bun:test"

import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"

import type { SqlStatement } from "../driver"
import { createStatement } from "../driver"
import { ConnectionError, QueryError } from "../driver-error"

import { TransactionConnectionError } from "./connection-loss"
import { TransactionCoordinator } from "./coordinator"
import { createTestCoordinator, failOn, holdOn, markHandled, run } from "./testing"

const readSetting = "SELECT current_setting($1)"
const setSetting = "SELECT set_config($1, $2, false)"
const previousSearchPath = '"$user", public'

/** Response that awaits `respond`, such as of `failOn` or `holdOn`, for every statement, and answers reading a setting with `previousSearchPath`. */
function respondWithSetting(respond: (statement: SqlStatement) => unknown = () => {}) {
  return async (statement: SqlStatement) => {
    await respond(statement)
    return statement.text === readSetting ? { rows: [[previousSearchPath]] } : {}
  }
}

it("runs statements and scripts of the callback on one reserved connection outside a transaction", async () => {
  const { driver, statements, scripts, releases } = createRecordingDriver()
  const coordinator = new TransactionCoordinator(driver)

  const result = await coordinator.session(async () => {
    await coordinator.execute(createStatement("first"))
    await coordinator.executeScript("script")
    await coordinator.execute(createStatement("second"))
    return "done"
  })
  await coordinator.execute(createStatement("outside"))

  expect(result).toBe("done")
  expect(statements).toEqual([
    { connection: 1, text: "first", parameters: [] },
    { connection: 1, text: "second", parameters: [] },
    { connection: "pool", text: "outside", parameters: [] },
  ])
  expect(scripts).toEqual([{ connection: 1, script: "script" }])
  expect(releases).toEqual([{ connection: 1 }])
})

it("rejects with the error of the callback without a statement that would undo its changes", async () => {
  const { driver, statements, releases } = createRecordingDriver()
  const coordinator = new TransactionCoordinator(driver)

  const failure = new Error("failure")
  const session = coordinator.session(async () => {
    await coordinator.execute(createStatement("inside"))
    throw failure
  })

  await expect(session).rejects.toBe(failure)
  expect(statements.map(({ text }) => text)).toEqual(["inside"])
  expect(releases).toEqual([{ connection: 1 }])
})

it("rejects with the failure to get its connection", async () => {
  const lost = new ConnectionError("lost")
  const { driver } = createRecordingDriver({
    acquire() {
      throw lost
    },
  })
  const coordinator = new TransactionCoordinator(driver)

  let called = false
  const session = coordinator.session(async () => {
    called = true
  })

  await expect(session).rejects.toBe(lost)
  expect(called).toBe(false)
})

it("rejects a statement from a finished session instead of running it on the pool", async () => {
  const { driver, statements } = createRecordingDriver()
  const coordinator = new TransactionCoordinator(driver)

  const { promise: finished, resolve: finish } = Promise.withResolvers<void>()
  let late: Promise<unknown> | undefined
  let lateTransaction: Promise<unknown> | undefined
  await coordinator.session(async () => {
    late = markHandled(finished.then(() => coordinator.execute(createStatement("late"))))
    lateTransaction = markHandled(
      finished.then(() => coordinator.transaction(() => Promise.resolve())),
    )
  })
  finish()

  await expect(late!).rejects.toThrow("Cannot execute a query: its session is already finished")
  await expect(lateTransaction!).rejects.toThrow(
    "Cannot start a transaction: its session is already finished",
  )
  expect(statements).toEqual([])
})

it("reports transaction-block status in sessions, transactions, and test levels", async () => {
  const { coordinator } = createTestCoordinator()
  const pooled = new TransactionCoordinator(createRecordingDriver().driver)
  const blocks: Record<string, boolean[]> = {}
  const read = (coordinator: TransactionCoordinator) => [
    coordinator.isInTransactionBlock(),
    coordinator.isInTransaction(),
  ]

  blocks.outside = read(pooled)
  await pooled.session(async () => {
    blocks.session = read(pooled)
    await pooled.transaction(async () => {
      blocks.transactionOfSession = read(pooled)
    })
    blocks.sessionAfterTransaction = read(pooled)
  })
  await pooled.transaction(async () => {
    blocks.transaction = read(pooled)
  })
  await coordinator.testTransaction(async () => {
    blocks.testTransaction = read(coordinator)
  })
  const fixture = await coordinator.createTestFixture(async () => {
    blocks.seed = read(coordinator)
  })
  await fixture.close()

  expect(blocks).toEqual({
    outside: [false, false],
    session: [false, false],
    transactionOfSession: [true, true],
    sessionAfterTransaction: [false, false],
    transaction: [true, true],
    testTransaction: [true, false],
    seed: [true, false],
  })
})

describe("where a session cannot start", () => {
  it("rejects inside a transaction and inside another session without calling the callback", async () => {
    const { driver, statements, releases } = createRecordingDriver()
    const coordinator = new TransactionCoordinator(driver)
    let called = false
    const start = () =>
      coordinator.session(async () => {
        called = true
      })

    await coordinator.transaction(async () => {
      await expect(start()).rejects.toThrow("Cannot start a session inside a transaction")
    })
    await coordinator.session(async () => {
      await expect(start()).rejects.toThrow("Cannot start a session inside a session")
      await coordinator.transaction(async () => {
        await expect(start()).rejects.toThrow("Cannot start a session inside a transaction")
      })
    })

    expect(called).toBe(false)
    expect(statements.map(({ text }) => text)).toEqual(["BEGIN", "COMMIT", "BEGIN", "COMMIT"])
    expect(releases).toEqual([{ connection: 1 }, { connection: 2 }])
  })

  it("rejects on a database created for tests, outside and inside a test transaction", async () => {
    const { coordinator, statements } = createTestCoordinator()
    const start = () => coordinator.session(() => Promise.resolve())

    await expect(start()).rejects.toThrow(
      "Cannot start a session: the database was created with test: true",
    )
    await coordinator.testTransaction(async () => {
      await expect(start()).rejects.toThrow("Cannot start a session inside a transaction")
    })
    const fixture = await coordinator.createTestFixture(async () => {
      await expect(start()).rejects.toThrow("Cannot start a session inside a transaction")
    })
    await fixture.close()

    expect(statements.every(({ connection }) => connection !== "pool")).toBe(true)
  })

  it("rejects after closing is requested, lets a running session end, and rejects closing inside a session", async () => {
    const { driver, statements } = createRecordingDriver()
    const coordinator = new TransactionCoordinator(driver)
    const { promise: started, resolve: start } = Promise.withResolvers<void>()
    const { promise: finished, resolve: finish } = Promise.withResolvers<void>()

    const running = coordinator.session(async () => {
      await expect(coordinator.close()).rejects.toThrow(
        "Cannot close the database inside a session",
      )
      start()
      await finished
      await coordinator.transaction(run(coordinator, "running"))
    })
    await started
    const closing = coordinator.close()

    await expect(coordinator.session(() => Promise.resolve())).rejects.toThrow(
      "Cannot start a session: the database is closed",
    )
    finish()
    await running
    await closing
    expect(statements.map(({ text }) => text)).toEqual(["BEGIN", "running", "COMMIT"])
  })
})

describe("transactions of a session", () => {
  it("begins and commits a transaction on the connection of the session, with savepoints nested in it", async () => {
    const { driver, statements, releases } = createRecordingDriver()
    const coordinator = new TransactionCoordinator(driver)

    await coordinator.session(async () => {
      await coordinator.execute(createStatement("before"))
      await coordinator.transaction(async () => {
        await coordinator.execute(createStatement("inside"))
        await coordinator.transaction(run(coordinator, "nested"))
      })
      await coordinator.ensureTransaction(run(coordinator, "joined"))
      await coordinator.execute(createStatement("after"))
    })

    expect(statements.map(({ connection, text }) => `${connection}: ${text}`)).toEqual([
      "1: before",
      "1: BEGIN",
      "1: inside",
      "1: SAVEPOINT kern_1",
      "1: nested",
      "1: RELEASE SAVEPOINT kern_1",
      "1: COMMIT",
      "1: BEGIN",
      "1: joined",
      "1: COMMIT",
      "1: after",
    ])
    expect(releases).toEqual([{ connection: 1 }])
  })

  it("starts a transaction at its isolation level with its settings, which end with it", async () => {
    const { driver, statements } = createRecordingDriver({ respond: respondWithSetting() })
    const coordinator = new TransactionCoordinator(driver)

    await coordinator.session(() =>
      coordinator.transaction(run(coordinator, "inside"), {
        isolation: "serializable",
        searchPath: ["tenant_1"],
      }),
    )

    expect(statements).toMatchObject([
      { text: "BEGIN ISOLATION LEVEL SERIALIZABLE" },
      { text: "SELECT set_config($1, $2, true)", parameters: ["search_path", '"tenant_1"'] },
      { text: "inside" },
      { text: "COMMIT" },
    ])
  })

  it("rolls back a transaction whose callback rejects and keeps the session open", async () => {
    const { driver, statements } = createRecordingDriver()
    const coordinator = new TransactionCoordinator(driver)

    const failure = new Error("failure")
    await coordinator.session(async () => {
      await expect(coordinator.transaction(() => Promise.reject(failure))).rejects.toBe(failure)
      await coordinator.execute(createStatement("after"))
    })

    expect(statements.map(({ text }) => text)).toEqual(["BEGIN", "ROLLBACK", "after"])
  })

  it("keeps the session open after a COMMIT that PostgreSQL rejected", async () => {
    const rejected = new QueryError("deferred constraint", { code: "23503" })
    const { driver, statements } = createRecordingDriver({ respond: failOn("COMMIT", rejected) })
    const coordinator = new TransactionCoordinator(driver)

    await coordinator.session(async () => {
      await expect(coordinator.transaction(() => Promise.resolve())).rejects.toBe(rejected)
      await coordinator.execute(createStatement("after"))
    })

    expect(statements.map(({ text }) => text)).toEqual(["BEGIN", "COMMIT", "after"])
  })

  it("rejects the statements of the session while its transaction runs, also while its BEGIN is pending", async () => {
    const begin = holdOn("BEGIN")
    const { driver, statements } = createRecordingDriver({ respond: begin.respond })
    const coordinator = new TransactionCoordinator(driver)

    await coordinator.session(async () => {
      const transaction = coordinator.transaction(run(coordinator, "inside"))
      await begin.reached
      await expect(coordinator.execute(createStatement("beside"))).rejects.toThrow(
        "Cannot execute a query: a transaction of the session is running; await it first",
      )
      await expect(coordinator.transaction(() => Promise.resolve())).rejects.toThrow(
        "Cannot start a transaction: a transaction of the session is running; await it first",
      )
      begin.resume()
      await transaction
      await coordinator.execute(createStatement("after"))
    })

    expect(statements.map(({ text }) => text)).toEqual(["BEGIN", "inside", "COMMIT", "after"])
  })

  it("frees the session after a transaction whose BEGIN fails", async () => {
    const rejected = new QueryError("rejected", { code: "57014" })
    const { driver, statements } = createRecordingDriver({ respond: failOn("BEGIN", rejected, 1) })
    const coordinator = new TransactionCoordinator(driver)

    let called = false
    await coordinator.session(async () => {
      const transaction = coordinator.transaction(async () => {
        called = true
      })
      await expect(transaction).rejects.toBe(rejected)
      await coordinator.transaction(run(coordinator, "inside"))
    })

    expect(called).toBe(false)
    expect(statements.map(({ text }) => text)).toEqual(["BEGIN", "BEGIN", "inside", "COMMIT"])
  })

  it("rolls back a transaction that is still running when the callback of the session finishes, and rejects", async () => {
    const { driver, statements, releases } = createRecordingDriver()
    const coordinator = new TransactionCoordinator(driver)
    const { promise: started, resolve: start } = Promise.withResolvers<void>()
    const { promise: finished, resolve: finish } = Promise.withResolvers<void>()

    let transaction: Promise<unknown> | undefined
    const session = coordinator.session(async () => {
      transaction = markHandled(
        coordinator.transaction(async () => {
          await coordinator.execute(createStatement("inside"))
          start()
          await finished
          await coordinator.execute(createStatement("late"))
        }),
      )
      await started
    })

    await expect(session).rejects.toThrow(
      "Session ended with an error: a transaction of it was still running when its callback finished",
    )
    finish()
    await expect(transaction!).rejects.toThrow(
      "Transaction was rolled back: its session ended first",
    )
    expect(statements.map(({ text }) => text)).toEqual(["BEGIN", "inside", "ROLLBACK"])
    expect(releases).toEqual([{ connection: 1 }])
  })

  it("awaits a COMMIT that is already sent when the callback of the session finishes, and rejects", async () => {
    const commit = holdOn("COMMIT")
    const events: string[] = []
    const { driver } = createRecordingDriver({
      async respond(statement) {
        await commit.respond(statement)
        events.push(statement.text)
        return {}
      },
      release() {
        events.push("release")
      },
    })
    const coordinator = new TransactionCoordinator(driver)

    let transaction: Promise<unknown> | undefined
    const session = markHandled(
      coordinator.session(async () => {
        transaction = coordinator.transaction(() => Promise.resolve("committed"))
        await commit.reached
      }),
    )
    await commit.reached
    commit.resume()

    await expect(session).rejects.toThrow("a transaction of it was still running")
    await expect(transaction!).resolves.toBe("committed")
    expect(events).toEqual(["BEGIN", "COMMIT", "release"])
  })

  it("rolls back a transaction whose BEGIN is still running when the callback of the session finishes", async () => {
    const begin = holdOn("BEGIN")
    const { driver, statements } = createRecordingDriver({ respond: begin.respond })
    const coordinator = new TransactionCoordinator(driver)

    let called = false
    let transaction: Promise<unknown> | undefined
    const session = markHandled(
      coordinator.session(async () => {
        transaction = markHandled(
          coordinator.transaction(async () => {
            called = true
          }),
        )
        await begin.reached
      }),
    )
    await begin.reached
    begin.resume()

    await expect(session).rejects.toThrow("a transaction of it was still running")
    await expect(transaction!).rejects.toThrow(
      "Transaction was rolled back: its session ended first",
    )
    expect(called).toBe(false)
    expect(statements.map(({ text }) => text)).toEqual(["BEGIN", "ROLLBACK"])
  })
})

describe("settings", () => {
  it("sets the quoted search path for the session before its callback and restores the previous one before its release", async () => {
    const setting = holdOn(setSetting)
    const events: string[] = []
    const { driver, statements } = createRecordingDriver({
      async respond(statement) {
        const result = await respondWithSetting(setting.respond)(statement)
        events.push(statement.text)
        return result
      },
      release() {
        events.push("release")
      },
    })
    const coordinator = new TransactionCoordinator(driver)

    let called = false
    const session = coordinator.session(
      async () => {
        called = true
        await coordinator.execute(createStatement("inside"))
        await coordinator.transaction(run(coordinator, "in transaction"))
      },
      { searchPath: ["tenant_1", 'Ext"ensions'] },
    )
    await setting.reached
    expect(called).toBe(false)
    setting.resume()
    await session

    expect(statements).toMatchObject([
      { connection: 1, text: readSetting, parameters: ["search_path"] },
      { text: setSetting, parameters: ["search_path", '"tenant_1", "Ext""ensions"'] },
      { text: "inside" },
      { text: "BEGIN" },
      { text: "in transaction" },
      { text: "COMMIT" },
      { text: setSetting, parameters: ["search_path", previousSearchPath] },
    ])
    expect(events.at(-2)).toBe(setSetting)
    expect(events.at(-1)).toBe("release")
  })

  it("restores the search path after a callback that rejects", async () => {
    const { driver, statements } = createRecordingDriver({ respond: respondWithSetting() })
    const coordinator = new TransactionCoordinator(driver)

    const failure = new Error("failure")
    const session = coordinator.session(() => Promise.reject(failure), {
      searchPath: ["tenant_1"],
    })

    await expect(session).rejects.toBe(failure)
    expect(statements.at(-1)).toMatchObject({
      text: setSetting,
      parameters: ["search_path", previousSearchPath],
    })
  })

  it("rejects without calling the callback when reading the previous setting fails, and changes nothing", async () => {
    const rejected = new QueryError("rejected", { code: "57014" })
    const { driver, statements, releases } = createRecordingDriver({
      respond: failOn(readSetting, rejected),
    })
    const coordinator = new TransactionCoordinator(driver)

    let called = false
    const session = coordinator.session(
      async () => {
        called = true
      },
      { searchPath: ["tenant_1"] },
    )

    await expect(session).rejects.toBe(rejected)
    expect(called).toBe(false)
    expect(statements.map(({ text }) => text)).toEqual([readSetting])
    expect(releases).toEqual([{ connection: 1 }])
  })

  it("restores the previous setting when setting the new one fails, since the statement may have run", async () => {
    const lost = new ConnectionError("timeout")
    const { driver, statements, releases } = createRecordingDriver({
      respond: respondWithSetting(failOn(setSetting, lost, 1)),
    })
    const coordinator = new TransactionCoordinator(driver)

    let called = false
    const session = coordinator.session(
      async () => {
        called = true
      },
      { searchPath: ["tenant_1"] },
    )

    await expect(session).rejects.toBe(lost)
    expect(called).toBe(false)
    expect(statements).toMatchObject([
      { text: readSetting },
      { text: setSetting, parameters: ["search_path", '"tenant_1"'] },
      { text: setSetting, parameters: ["search_path", previousSearchPath] },
    ])
    expect(releases).toEqual([{ connection: 1 }])
  })
})

describe("failures of restoring settings", () => {
  /** Runs a session with a search path whose statements `respond` answers, and returns what it sent and reported. */
  async function runSession(respond: (statement: SqlStatement) => unknown) {
    const reported: unknown[] = []
    const events: string[] = []
    const { driver } = createRecordingDriver({
      async respond(statement) {
        events.push(statement.text)
        return await respondWithSetting(respond)(statement)
      },
      release() {
        events.push("release")
      },
    })
    const coordinator = new TransactionCoordinator(driver, {
      onReleaseError: error => reported.push(error),
    })
    const result = await coordinator.session(() => Promise.resolve("done"), {
      searchPath: ["tenant_1"],
    })
    return { result, reported, events }
  }

  it("leaves the connection in a transaction, so that the driver closes it, reports the failure, and keeps the result", async () => {
    const rejected = new QueryError("canceled", { code: "57014" })

    const { result, reported, events } = await runSession(failOn(setSetting, rejected, 2))

    expect(result).toBe("done")
    expect(events).toEqual([readSetting, setSetting, setSetting, "BEGIN", "release"])
    expect(reported).toHaveLength(1)
    expect(reported[0]).toMatchObject({
      message: "Restoring the settings of a session failed",
      cause: rejected,
    })
  })

  it("sends BEGIN again while PostgreSQL rejects it, and releases the connection only once one completes", async () => {
    const rejected = new QueryError("canceled", { code: "57014" })
    const failRestore = failOn(setSetting, rejected, 2)
    let begins = 0

    const { events } = await runSession(statement => {
      failRestore(statement)
      if (statement.text === "BEGIN" && ++begins < 4) {
        throw rejected
      }
    })

    expect(events).toEqual([
      readSetting,
      setSetting,
      setSetting,
      "BEGIN",
      "BEGIN",
      "BEGIN",
      "BEGIN",
      "release",
    ])
  })

  it("releases a connection that rejects BEGIN in a failed transaction, which the driver closes", async () => {
    const failed = new QueryError("current transaction is aborted", { code: "25P02" })
    let restores = 0

    const { events, reported } = await runSession(statement => {
      if (statement.text === "BEGIN" || (statement.text === setSetting && ++restores === 2)) {
        throw failed
      }
    })

    expect(events).toEqual([readSetting, setSetting, setSetting, "BEGIN", "release"])
    expect(reported).toHaveLength(1)
  })

  it("releases a connection whose BEGIN fails with ConnectionError, which the driver closes, without reporting a lost connection", async () => {
    const lost = new ConnectionError("lost")
    let restores = 0

    const { result, events, reported } = await runSession(statement => {
      if (statement.text === "BEGIN" || (statement.text === setSetting && ++restores === 2)) {
        throw lost
      }
    })

    expect(result).toBe("done")
    expect(events).toEqual([readSetting, setSetting, setSetting, "BEGIN", "release"])
    expect(reported).toEqual([])
  })
})

describe("connection failures", () => {
  it("rejects the later statements and transactions of a session after a ConnectionError, and still restores its settings", async () => {
    const lost = new ConnectionError("lost")
    const { driver, statements, releases } = createRecordingDriver({
      respond: respondWithSetting(failOn("failing", lost)),
    })
    const coordinator = new TransactionCoordinator(driver)

    await coordinator.session(
      async () => {
        await expect(coordinator.execute(createStatement("failing"))).rejects.toBe(lost)
        const statement = coordinator.execute(createStatement("after"))
        await expect(statement).rejects.toThrow(
          "Cannot execute a query: the connection of the session failed, so the session accepts no more statements",
        )
        await expect(statement).rejects.toMatchObject({ cause: lost })
        await expect(coordinator.transaction(() => Promise.resolve())).rejects.toThrow(
          "Cannot start a transaction: the connection of the session failed",
        )
      },
      { searchPath: ["tenant_1"] },
    )

    expect(statements.map(({ text }) => text)).toEqual([
      readSetting,
      setSetting,
      "failing",
      setSetting,
    ])
    expect(releases).toEqual([{ connection: 1 }])
  })

  it("keeps a session open after a statement that PostgreSQL rejected", async () => {
    const rejected = new QueryError("rejected", { code: "23505" })
    const { driver, statements } = createRecordingDriver({ respond: failOn("failing", rejected) })
    const coordinator = new TransactionCoordinator(driver)

    await coordinator.session(async () => {
      await expect(coordinator.execute(createStatement("failing"))).rejects.toBe(rejected)
      await coordinator.execute(createStatement("after"))
    })

    expect(statements.map(({ text }) => text)).toEqual(["failing", "after"])
  })

  it("rejects a transaction of a session whose connection fails with TransactionConnectionError, and then the statements of the session", async () => {
    const lost = new ConnectionError("lost")
    const { driver, statements } = createRecordingDriver({ respond: failOn("failing", lost) })
    const coordinator = new TransactionCoordinator(driver)

    await coordinator.session(async () => {
      const transaction = coordinator.transaction(run(coordinator, "failing"))
      await expect(transaction).rejects.toBeInstanceOf(TransactionConnectionError)
      await expect(transaction).rejects.toMatchObject({ phase: "transaction", cause: lost })
      await expect(coordinator.execute(createStatement("after"))).rejects.toThrow(
        "the connection of the session failed",
      )
    })

    expect(statements.map(({ text }) => text)).toEqual(["BEGIN", "failing", "ROLLBACK"])
  })

  it("rejects a transaction of a session whose BEGIN fails with phase begin", async () => {
    const lost = new ConnectionError("lost")
    const { driver } = createRecordingDriver({ respond: failOn("BEGIN", lost) })
    const coordinator = new TransactionCoordinator(driver)

    await coordinator.session(async () => {
      await expect(coordinator.transaction(() => Promise.resolve())).rejects.toMatchObject({
        phase: "begin",
        cause: lost,
      })
    })
  })
})
