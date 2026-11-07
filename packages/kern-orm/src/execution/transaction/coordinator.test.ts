import { describe, expect, it } from "bun:test"

import type { SqlStatement } from "kern-orm"
import { createStatement } from "kern-orm"

import { createRecordingDriver } from "../../../testing/recording-driver"

import { TransactionCoordinator } from "./coordinator"
import {
  createTestCoordinator,
  failOn,
  holdOn,
  markHandled,
  run,
  seedNothing,
  settleCallbacks,
} from "./testing"

it("runs statements of the callback on the transaction connection", async () => {
  const { driver, statements, releases } = createRecordingDriver()
  const coordinator = new TransactionCoordinator(driver)

  await coordinator.execute(createStatement("outside"))
  await coordinator.transaction(async () => {
    await coordinator.execute(createStatement("inside"))
  })

  expect(statements).toEqual([
    { connection: "pool", text: "outside", parameters: [] },
    { connection: 1, text: "BEGIN", parameters: [] },
    { connection: 1, text: "inside", parameters: [] },
    { connection: 1, text: "COMMIT", parameters: [] },
  ])
  expect(releases).toEqual([{ connection: 1 }])
})

it("rolls back when the callback rejects", async () => {
  const { driver, statements, releases } = createRecordingDriver()
  const coordinator = new TransactionCoordinator(driver)

  const failure = new Error("failure")
  await expect(coordinator.transaction(() => Promise.reject(failure))).rejects.toBe(failure)

  expect(statements.map(({ text }) => text)).toEqual(["BEGIN", "ROLLBACK"])
  expect(releases).toEqual([{ connection: 1 }])
})

it("rejects when PostgreSQL rolls back on COMMIT", async () => {
  const { driver, releases } = createRecordingDriver({
    respond: ({ text }) => (text === "COMMIT" ? { command: "ROLLBACK" } : {}),
  })
  const coordinator = new TransactionCoordinator(driver)

  await expect(coordinator.transaction(() => Promise.resolve("done"))).rejects.toThrow(
    "Transaction was rolled back",
  )
  expect(releases).toEqual([{ connection: 1 }])
})

it("rejects a query from a finished transaction instead of running it on the pool", async () => {
  const { driver, statements } = createRecordingDriver()
  const coordinator = new TransactionCoordinator(driver)

  const { promise: finished, resolve: finish } = Promise.withResolvers<void>()
  let late: Promise<unknown> | undefined
  await coordinator.transaction(async () => {
    late = finished.then(() => coordinator.execute(createStatement("late")))
  })
  finish()

  await expect(late!).rejects.toThrow("transaction is already finished")
  expect(statements.map(({ text }) => text)).toEqual(["BEGIN", "COMMIT"])
})

it("rejects a query issued after the callback, and ends the transaction after the earlier queries", async () => {
  const { promise: earlyHeld, resolve: finishEarly } = Promise.withResolvers<void>()
  const { promise: lateIssued, resolve: issueLate } = Promise.withResolvers<void>()
  const events: string[] = []
  const { driver } = createRecordingDriver({
    async respond({ text }) {
      if (text === "early") {
        await earlyHeld
      }
      events.push(text)
      return {}
    },
    release() {
      events.push("release")
    },
  })
  const coordinator = new TransactionCoordinator(driver)

  let early: Promise<unknown> | undefined
  let late: Promise<unknown> | undefined
  let lateThrew = false
  const transaction = coordinator.transaction(async () => {
    early = coordinator.execute(createStatement("early"))
    // A timer keeps the async context of the callback and fires after COMMIT is queued behind the held query.
    setTimeout(() => {
      try {
        late = coordinator.execute(createStatement("late"))
      } catch {
        lateThrew = true
      }
      issueLate()
    })
  })
  await lateIssued

  expect(lateThrew).toBe(false)
  await expect(late!).rejects.toThrow("transaction is already finished")
  expect(events).toEqual(["BEGIN"])
  finishEarly()
  await transaction
  await early
  expect(events).toEqual(["BEGIN", "early", "COMMIT", "release"])
})

it("rejects closing inside a transaction instead of waiting for the transaction forever", async () => {
  const { driver } = createRecordingDriver()
  const coordinator = new TransactionCoordinator(driver)

  await coordinator.transaction(async () => {
    await expect(coordinator.close()).rejects.toThrow(
      "Cannot close the database inside a transaction",
    )
  })
})

it("rejects queries and transactions started after closing is requested, lets a running transaction end, and closes once", async () => {
  const { driver, statements } = createRecordingDriver()
  let driverClosings = 0
  driver.close = () => {
    driverClosings++
    return Promise.resolve()
  }
  const coordinator = new TransactionCoordinator(driver)
  const { promise: started, resolve: start } = Promise.withResolvers<void>()
  const { promise: finished, resolve: finish } = Promise.withResolvers<void>()

  const running = coordinator.transaction(async () => {
    start()
    await finished
    await coordinator.execute(createStatement("running"))
  })
  await started
  const closing = coordinator.close()

  expect(coordinator.close()).toBe(closing)
  await expect(coordinator.execute(createStatement("late"))).rejects.toThrow(
    "Cannot execute a query: the database is closed",
  )
  await expect(coordinator.transaction(() => Promise.resolve())).rejects.toThrow(
    "Cannot start a transaction: the database is closed",
  )
  finish()
  await running
  await closing
  expect(statements.map(({ text }) => text)).toEqual(["BEGIN", "running", "COMMIT"])
  expect(driverClosings).toBe(1)
})

describe("nested transactions", () => {
  it("runs in a savepoint that is released on success", async () => {
    const { driver, statements } = createRecordingDriver()
    const coordinator = new TransactionCoordinator(driver)

    await coordinator.transaction(async () => {
      await coordinator.transaction(async () => {
        await coordinator.execute(createStatement("inside"))
      })
    })

    expect(statements.map(({ connection, text }) => `${connection}: ${text}`)).toEqual([
      "1: BEGIN",
      "1: SAVEPOINT kern_1",
      "1: inside",
      "1: RELEASE SAVEPOINT kern_1",
      "1: COMMIT",
    ])
  })

  it("rolls back to its savepoint on failure and keeps the enclosing transaction", async () => {
    const { driver, statements } = createRecordingDriver()
    const coordinator = new TransactionCoordinator(driver)

    const failure = new Error("failure")
    await coordinator.transaction(async () => {
      await expect(coordinator.transaction(() => Promise.reject(failure))).rejects.toBe(failure)
      await coordinator.execute(createStatement("after"))
    })

    expect(statements.map(({ text }) => text)).toEqual([
      "BEGIN",
      "SAVEPOINT kern_1",
      "ROLLBACK TO SAVEPOINT kern_1",
      "RELEASE SAVEPOINT kern_1",
      "after",
      "COMMIT",
    ])
  })

  // Orchid ORM kept the state of such a nested transaction in its enclosing one after it ended: https://github.com/romeerez/orchid-orm/pull/804
  it("rolls back to its savepoint when its callback throws synchronously, and keeps the enclosing transaction", async () => {
    const { driver, statements } = createRecordingDriver()
    const coordinator = new TransactionCoordinator(driver)
    const failure = new Error("failure")

    await coordinator.transaction(async () => {
      const failed = coordinator.transaction(() => {
        throw failure
      })
      await expect(failed).rejects.toBe(failure)
      await coordinator.execute(createStatement("after"))
      await coordinator.transaction(run(coordinator, "nested"))
    })

    expect(statements.map(({ connection, text }) => `${connection}: ${text}`)).toEqual([
      "1: BEGIN",
      "1: SAVEPOINT kern_1",
      "1: ROLLBACK TO SAVEPOINT kern_1",
      "1: RELEASE SAVEPOINT kern_1",
      "1: after",
      "1: SAVEPOINT kern_1",
      "1: nested",
      "1: RELEASE SAVEPOINT kern_1",
      "1: COMMIT",
    ])
  })

  it("rejects queries and other nested transactions of the enclosing transaction while it starts and runs", async () => {
    const savepoint = holdOn("SAVEPOINT kern_1")
    const { driver, statements } = createRecordingDriver({ respond: savepoint.respond })
    const coordinator = new TransactionCoordinator(driver)
    const { promise: finished, resolve: finish } = Promise.withResolvers<void>()

    const { promise: running, resolve: started } = Promise.withResolvers<void>()

    await coordinator.transaction(async () => {
      const nested = coordinator.transaction(() => {
        started()
        return finished
      })
      await savepoint.reached
      await expect(coordinator.execute(createStatement("starting"))).rejects.toThrow(
        "a nested transaction is running",
      )
      await expect(coordinator.transaction(() => Promise.resolve())).rejects.toThrow(
        "Cannot start a nested transaction: a nested transaction is running",
      )
      savepoint.resume()
      await running
      await expect(coordinator.execute(createStatement("running"))).rejects.toThrow(
        "a nested transaction is running",
      )
      await expect(coordinator.transaction(() => Promise.resolve())).rejects.toThrow(
        "Cannot start a nested transaction: a nested transaction is running",
      )
      finish()
      await nested
      await coordinator.execute(createStatement("after"))
    })

    expect(statements.map(({ text }) => text)).toEqual([
      "BEGIN",
      "SAVEPOINT kern_1",
      "RELEASE SAVEPOINT kern_1",
      "after",
      "COMMIT",
    ])
  })

  it("rejects a query of a released savepoint instead of running it in the enclosing transaction", async () => {
    const { driver, statements } = createRecordingDriver()
    const coordinator = new TransactionCoordinator(driver)
    const { promise: finished, resolve: finish } = Promise.withResolvers<void>()

    let late: Promise<unknown> | undefined
    await coordinator.transaction(async () => {
      await coordinator.transaction(async () => {
        late = finished.then(() => coordinator.execute(createStatement("late")))
      })
      finish()
      await expect(late!).rejects.toThrow("transaction is already finished")
    })

    expect(statements.map(({ text }) => text)).not.toContain("late")
  })

  it("rolls back every level when the transaction finishes while nested levels run", async () => {
    const { driver, statements, releases } = createRecordingDriver()
    const coordinator = new TransactionCoordinator(driver)
    const { promise: grandchildRunning, resolve: grandchildStarted } = Promise.withResolvers<void>()
    const { promise: finished, resolve: finish } = Promise.withResolvers<void>()

    let child: Promise<unknown> | undefined
    let grandchild: Promise<unknown> | undefined
    let late: Promise<unknown> | undefined
    const transaction = coordinator.transaction(async () => {
      child = markHandled(
        coordinator.transaction(async () => {
          grandchild = markHandled(
            coordinator.transaction(async () => {
              grandchildStarted()
              await finished
              late = markHandled(coordinator.execute(createStatement("late")))
            }),
          )
          await grandchild
        }),
      )
      await grandchildRunning
    })

    await expect(transaction).rejects.toThrow("a nested transaction was still running")
    finish()
    await expect(grandchild!).rejects.toThrow("its enclosing transaction ended first")
    await expect(child!).rejects.toThrow("its enclosing transaction ended first")
    await expect(late!).rejects.toThrow("transaction is already finished")
    expect(statements.map(({ text }) => text)).toEqual([
      "BEGIN",
      "SAVEPOINT kern_1",
      "SAVEPOINT kern_2",
      "ROLLBACK TO SAVEPOINT kern_2",
      "RELEASE SAVEPOINT kern_2",
      "ROLLBACK TO SAVEPOINT kern_1",
      "RELEASE SAVEPOINT kern_1",
      "ROLLBACK",
    ])
    expect(releases).toEqual([{ connection: 1 }])
  })

  it("waits for the cleanup of a nested level that already started before ending the transaction", async () => {
    const rollback = holdOn("ROLLBACK TO SAVEPOINT kern_1")
    const { driver, statements, releases } = createRecordingDriver({ respond: rollback.respond })
    const coordinator = new TransactionCoordinator(driver)

    const failure = new Error("failure")
    let nested: Promise<unknown> | undefined
    const transaction = coordinator.transaction(async () => {
      nested = markHandled(coordinator.transaction(() => Promise.reject(failure)))
      await rollback.reached
    })
    await rollback.reached
    await settleCallbacks()
    rollback.resume()

    await expect(transaction).rejects.toThrow("a nested transaction was still running")
    await expect(nested!).rejects.toBe(failure)
    expect(statements.map(({ text }) => text)).toEqual([
      "BEGIN",
      "SAVEPOINT kern_1",
      "ROLLBACK TO SAVEPOINT kern_1",
      "RELEASE SAVEPOINT kern_1",
      "ROLLBACK",
    ])
    expect(releases).toEqual([{ connection: 1 }])
  })

  it("ends a nested level whose transaction finished while its SAVEPOINT ran, without calling its callback", async () => {
    const savepoint = holdOn("SAVEPOINT kern_1")
    const { driver, statements } = createRecordingDriver({ respond: savepoint.respond })
    const coordinator = new TransactionCoordinator(driver)

    let called = false
    let nested: Promise<unknown> | undefined
    const transaction = coordinator.transaction(async () => {
      nested = markHandled(
        coordinator.transaction(async () => {
          called = true
        }),
      )
      await savepoint.reached
    })
    await savepoint.reached
    await settleCallbacks()
    savepoint.resume()

    await expect(transaction).rejects.toThrow("a nested transaction was still running")
    await expect(nested!).rejects.toThrow("its enclosing transaction ended first")
    expect(called).toBe(false)
    expect(statements.map(({ text }) => text)).toEqual([
      "BEGIN",
      "SAVEPOINT kern_1",
      "ROLLBACK TO SAVEPOINT kern_1",
      "RELEASE SAVEPOINT kern_1",
      "ROLLBACK",
    ])
  })

  it("rejects with a failed SAVEPOINT without calling the callback and frees the enclosing transaction", async () => {
    const savepointError = new Error("savepoint")
    const { driver, statements } = createRecordingDriver({
      respond: failOn("SAVEPOINT kern_1", savepointError),
    })
    const coordinator = new TransactionCoordinator(driver)

    let called = false
    await coordinator.transaction(async () => {
      const nested = coordinator.transaction(async () => {
        called = true
      })
      await expect(nested).rejects.toBe(savepointError)
      await coordinator.execute(createStatement("after"))
    })

    expect(called).toBe(false)
    expect(statements.map(({ text }) => text)).toEqual([
      "BEGIN",
      "SAVEPOINT kern_1",
      "after",
      "COMMIT",
    ])
  })

  it("keeps both errors of a failed SAVEPOINT and of the rollback its transaction started meanwhile", async () => {
    const savepointError = new Error("savepoint")
    const rollbackError = new Error("rollback")
    const savepoint = holdOn("SAVEPOINT kern_1")
    const { driver } = createRecordingDriver({
      async respond(statement) {
        await savepoint.respond(statement)
        if (statement.text === "SAVEPOINT kern_1") {
          throw savepointError
        }
        if (statement.text === "ROLLBACK TO SAVEPOINT kern_1") {
          throw rollbackError
        }
        return {}
      },
    })
    const coordinator = new TransactionCoordinator(driver)

    let nested: Promise<unknown> | undefined
    const transaction = markHandled(
      coordinator.transaction(async () => {
        nested = markHandled(coordinator.transaction(() => Promise.resolve()))
        await savepoint.reached
      }),
    )
    await savepoint.reached
    await settleCallbacks()
    savepoint.resume()

    expect(await nested!.catch((error: unknown) => error)).toMatchObject({
      error: rollbackError,
      suppressed: savepointError,
    })
    await expect(transaction).rejects.toThrow()
  })

  it("rolls back the transaction after a nested level fails to end, even when the error is caught", async () => {
    const releaseError = new Error("release")
    const { driver, statements, releases } = createRecordingDriver({
      respond: failOn("RELEASE SAVEPOINT kern_1", releaseError),
    })
    const coordinator = new TransactionCoordinator(driver)

    const transaction = coordinator.transaction(async () => {
      await expect(coordinator.transaction(() => Promise.resolve())).rejects.toBe(releaseError)
      await expect(coordinator.execute(createStatement("after"))).rejects.toThrow(
        "the transaction can only roll back",
      )
    })

    await expect(transaction).rejects.toThrow("a nested transaction failed to end")
    expect(statements.map(({ text }) => text)).toEqual([
      "BEGIN",
      "SAVEPOINT kern_1",
      "RELEASE SAVEPOINT kern_1",
      "ROLLBACK",
    ])
    expect(releases).toEqual([{ connection: 1 }])
  })

  it("keeps the rollback error of a nested level that its transaction ended", async () => {
    const rollbackError = new Error("rollback")
    const { driver, statements, releases } = createRecordingDriver({
      respond: failOn("ROLLBACK TO SAVEPOINT kern_1", rollbackError),
    })
    const coordinator = new TransactionCoordinator(driver)
    const { promise: running, resolve: started } = Promise.withResolvers<void>()
    const { promise: finished, resolve: finish } = Promise.withResolvers<void>()

    let nested: Promise<unknown> | undefined
    const transaction = coordinator.transaction(async () => {
      nested = markHandled(
        coordinator.transaction(() => {
          started()
          return finished
        }),
      )
      await running
    })

    const rejection = await transaction.catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(SuppressedError)
    expect(rejection).toMatchObject({
      error: rollbackError,
      suppressed: { message: expect.stringContaining("a nested transaction was still running") },
    })
    expect(statements.map(({ text }) => text)).toEqual([
      "BEGIN",
      "SAVEPOINT kern_1",
      "ROLLBACK TO SAVEPOINT kern_1",
      "ROLLBACK",
    ])
    expect(releases).toEqual([{ connection: 1 }])
    finish()
    expect(await nested!.catch((error: unknown) => error)).toMatchObject({
      error: rollbackError,
      suppressed: { message: expect.stringContaining("its enclosing transaction ended first") },
    })
  })

  it("keeps the rollback errors of both a nested level and its transaction", async () => {
    const nestedError = new Error("nested rollback")
    const rootError = new Error("rollback")
    const { driver, releases } = createRecordingDriver({
      respond({ text }) {
        if (text === "ROLLBACK TO SAVEPOINT kern_1") {
          throw nestedError
        }
        if (text === "ROLLBACK") {
          throw rootError
        }
        return {}
      },
    })
    const coordinator = new TransactionCoordinator(driver)
    const { promise: running, resolve: started } = Promise.withResolvers<void>()

    const transaction = coordinator.transaction(async () => {
      markHandled(
        coordinator.transaction(() => {
          started()
          return new Promise(() => {})
        }),
      )
      await running
    })

    const rejection = await transaction.catch((error: unknown) => error)
    expect(rejection).toMatchObject({
      error: { error: rootError, suppressed: nestedError },
      suppressed: { message: expect.stringContaining("a nested transaction was still running") },
    })
    expect(releases).toEqual([{ connection: 1, failure: { error: rootError } }])
  })
})

describe("joining the current transaction", () => {
  it("starts a transaction outside of one and joins the current one without a savepoint", async () => {
    const { driver, statements } = createRecordingDriver()
    const coordinator = new TransactionCoordinator(driver)

    const outside = coordinator.isInTransaction()
    await coordinator.ensureTransaction(run(coordinator, "started"))
    await coordinator.transaction(async () => {
      await coordinator.ensureTransaction(run(coordinator, "joined"))
    })

    expect(outside).toBe(false)
    expect(statements.map(({ connection, text }) => `${connection}: ${text}`)).toEqual([
      "1: BEGIN",
      "1: started",
      "1: COMMIT",
      "2: BEGIN",
      "2: joined",
      "2: COMMIT",
    ])
  })

  it("keeps the changes of a joined callback that rejects, which the transaction commits", async () => {
    const { driver, statements } = createRecordingDriver()
    const coordinator = new TransactionCoordinator(driver)

    const failure = new Error("failure")
    await coordinator.transaction(async () => {
      await expect(
        coordinator.ensureTransaction(async () => {
          await run(coordinator, "joined")()
          throw failure
        }),
      ).rejects.toBe(failure)
    })

    expect(statements.map(({ text }) => text)).toEqual(["BEGIN", "joined", "COMMIT"])
  })

  it("rejects without calling the callback when the transaction accepts no statements", async () => {
    const releaseError = new Error("release failed")
    const { driver } = createRecordingDriver({
      respond: failOn("RELEASE SAVEPOINT kern_1", releaseError),
    })
    const coordinator = new TransactionCoordinator(driver)
    const calls: string[] = []
    const join = (name: string) =>
      markHandled(
        coordinator.ensureTransaction(async () => {
          calls.push(name)
        }),
      )

    const { promise: finished, resolve: finish } = Promise.withResolvers<void>()
    let late: Promise<unknown> | undefined
    await coordinator.transaction(async () => {
      late = finished.then(() => join("late"))
    })
    finish()
    await expect(late!).rejects.toThrow(
      "Cannot join the transaction: its transaction is already finished",
    )

    const { promise: held, resolve: release } = Promise.withResolvers<void>()
    const transaction = markHandled(
      coordinator.transaction(async () => {
        const nested = markHandled(coordinator.transaction(() => held))
        await expect(join("beside a nested transaction")).rejects.toThrow(
          "Cannot join the transaction: a nested transaction is running",
        )
        release()
        // Its RELEASE fails, so the transaction can only roll back.
        await expect(nested).rejects.toBe(releaseError)
        await expect(join("after a failed release")).rejects.toThrow(
          "Cannot join the transaction: a nested transaction failed to end",
        )
      }),
    )
    await expect(transaction).rejects.toThrow("Transaction was rolled back")
    expect(calls).toEqual([])
  })

  it("reports true in a transaction and its nested test levels, and false in a test transaction or seed alone", async () => {
    const { coordinator } = createTestCoordinator()
    const seen: Record<string, boolean> = {}

    await using _fixture = await coordinator.createTestFixture(async () => {
      seen.seed = coordinator.isInTransaction()
    })
    await coordinator.testTransaction(async () => {
      seen.testTransaction = coordinator.isInTransaction()
      await coordinator.transaction(async () => {
        seen.transaction = coordinator.isInTransaction()
        await coordinator.testTransaction(async () => {
          seen.testTransactionInTransaction = coordinator.isInTransaction()
        })
      })
    })

    expect(seen).toEqual({
      seed: false,
      testTransaction: false,
      transaction: true,
      testTransactionInTransaction: true,
    })
  })

  it("starts a nested transaction in a test transaction, as it starts a transaction in production", async () => {
    const { coordinator, statements } = createTestCoordinator()

    const failure = new Error("failure")
    await coordinator.testTransaction(async () => {
      await expect(
        coordinator.ensureTransaction(async () => {
          await run(coordinator, "rolled back")()
          throw failure
        }),
      ).rejects.toBe(failure)
    })

    expect(statements.map(({ text }) => text)).toEqual([
      "BEGIN",
      "SAVEPOINT kern_1",
      "rolled back",
      "ROLLBACK TO SAVEPOINT kern_1",
      "RELEASE SAVEPOINT kern_1",
      "ROLLBACK",
    ])
  })
})

describe("settings", () => {
  const readSetting = "SELECT current_setting($1)"
  const setSetting = "SELECT set_config($1, $2, true)"
  const previousSearchPath = '"$user", public'

  /** Response that awaits `respond`, such as of `failOn` or `holdOn`, for every statement, and answers reading a setting with `previousSearchPath`. */
  function respondWithSetting(respond: (statement: SqlStatement) => unknown = () => {}) {
    return async (statement: SqlStatement) => {
      await respond(statement)
      return statement.text === readSetting ? { rows: [[previousSearchPath]] } : {}
    }
  }

  it("sets the quoted search path of a transaction after its BEGIN and calls its callback once the setting completes", async () => {
    const setting = holdOn(setSetting)
    const { driver, statements } = createRecordingDriver({ respond: setting.respond })
    const coordinator = new TransactionCoordinator(driver)

    let called = false
    const transaction = coordinator.transaction(
      async () => {
        called = true
        await coordinator.execute(createStatement("inside"))
      },
      { searchPath: ["tenant_1", 'Ext"ensions'] },
    )
    await setting.reached
    await settleCallbacks()
    expect(called).toBe(false)
    setting.resume()
    await transaction

    expect(statements).toEqual([
      { connection: 1, text: "BEGIN", parameters: [] },
      {
        connection: 1,
        text: setSetting,
        parameters: ["search_path", '"tenant_1", "Ext""ensions"'],
      },
      { connection: 1, text: "inside", parameters: [] },
      { connection: 1, text: "COMMIT", parameters: [] },
    ])
  })

  it("restores the settings that a nested level replaced before its RELEASE", async () => {
    const { driver, statements } = createRecordingDriver({ respond: respondWithSetting() })
    const coordinator = new TransactionCoordinator(driver)

    await coordinator.transaction(() =>
      coordinator.transaction(run(coordinator, "inside"), { searchPath: ["tenant_1"] }),
    )

    expect(statements).toMatchObject([
      { text: "BEGIN" },
      { text: "SAVEPOINT kern_1" },
      { text: readSetting, parameters: ["search_path"] },
      { text: setSetting, parameters: ["search_path", '"tenant_1"'] },
      { text: "inside" },
      { text: setSetting, parameters: ["search_path", previousSearchPath] },
      { text: "RELEASE SAVEPOINT kern_1" },
      { text: "COMMIT" },
    ])
  })

  it("rolls back a nested level without restoring its settings, which the rollback restores", async () => {
    const { driver, statements } = createRecordingDriver({ respond: respondWithSetting() })
    const coordinator = new TransactionCoordinator(driver)

    const failure = new Error("failure")
    await coordinator.transaction(async () => {
      const nested = coordinator.transaction(() => Promise.reject(failure), {
        searchPath: ["tenant_1"],
      })
      await expect(nested).rejects.toBe(failure)
    })

    expect(statements.map(({ text }) => text)).toEqual([
      "BEGIN",
      "SAVEPOINT kern_1",
      readSetting,
      setSetting,
      "ROLLBACK TO SAVEPOINT kern_1",
      "RELEASE SAVEPOINT kern_1",
      "COMMIT",
    ])
  })

  it("rejects with failed settings without calling the callback, and rolls back the transaction", async () => {
    const settingError = new Error("setting")
    const { driver, statements, releases } = createRecordingDriver({
      respond: failOn(setSetting, settingError),
    })
    const coordinator = new TransactionCoordinator(driver)

    let called = false
    const transaction = coordinator.transaction(
      async () => {
        called = true
      },
      { searchPath: ["tenant_1"] },
    )

    await expect(transaction).rejects.toBe(settingError)
    expect(called).toBe(false)
    expect(statements.map(({ text }) => text)).toEqual(["BEGIN", setSetting, "ROLLBACK"])
    expect(releases).toEqual([{ connection: 1 }])
  })

  it("rejects with failed settings of a nested level without calling its callback, and frees the enclosing transaction", async () => {
    const settingError = new Error("setting")
    const { driver, statements } = createRecordingDriver({
      respond: respondWithSetting(failOn(setSetting, settingError)),
    })
    const coordinator = new TransactionCoordinator(driver)

    let called = false
    await coordinator.transaction(async () => {
      const nested = coordinator.transaction(
        async () => {
          called = true
        },
        { searchPath: ["tenant_1"] },
      )
      await expect(nested).rejects.toBe(settingError)
      await coordinator.execute(createStatement("after"))
    })

    expect(called).toBe(false)
    expect(statements.map(({ text }) => text)).toEqual([
      "BEGIN",
      "SAVEPOINT kern_1",
      readSetting,
      setSetting,
      "ROLLBACK TO SAVEPOINT kern_1",
      "RELEASE SAVEPOINT kern_1",
      "after",
      "COMMIT",
    ])
  })

  it("rolls back the transaction after a nested level fails to restore its settings", async () => {
    const restoreError = new Error("restore")
    const { driver, statements } = createRecordingDriver({
      respond: respondWithSetting(failOn(setSetting, restoreError, 2)),
    })
    const coordinator = new TransactionCoordinator(driver)

    const transaction = coordinator.transaction(async () => {
      const nested = coordinator.transaction(() => Promise.resolve(), {
        searchPath: ["tenant_1"],
      })
      await expect(nested).rejects.toBe(restoreError)
      await expect(coordinator.execute(createStatement("after"))).rejects.toThrow(
        "the transaction can only roll back",
      )
    })

    await expect(transaction).rejects.toThrow("a nested transaction failed to end")
    expect(statements.map(({ text }) => text)).toEqual([
      "BEGIN",
      "SAVEPOINT kern_1",
      readSetting,
      setSetting,
      setSetting,
      "ROLLBACK",
    ])
  })

  // Orchid ORM restored a setting still in flight at the rollback of a test transaction after the rollback, which left it on the connection for later tests: https://github.com/romeerez/orchid-orm/pull/813
  const startStatements = ["SAVEPOINT kern_1", readSetting, setSetting]
  for (const { step, text } of [
    { step: "its SAVEPOINT", text: "SAVEPOINT kern_1" },
    { step: "the reading of its settings", text: readSetting },
    { step: "its settings", text: setSetting },
  ]) {
    it(`rolls back a nested level whose test transaction aborts during ${step}, and sends nothing after the rollback`, async () => {
      const held = holdOn(text)
      const { coordinator, statements, releases } = createTestCoordinator({
        respond: respondWithSetting(held.respond),
      })
      const controller = new AbortController()

      let called = false
      const test = coordinator.testTransaction(
        () =>
          coordinator.transaction(
            async () => {
              called = true
            },
            { searchPath: ["tenant_1"] },
          ),
        { signal: controller.signal },
      )
      await held.reached
      controller.abort()
      held.resume()

      await expect(test).rejects.toBe(controller.signal.reason)
      await settleCallbacks()
      expect(called).toBe(false)
      expect(statements.map(statement => statement.text)).toEqual([
        "BEGIN",
        ...startStatements.slice(0, startStatements.indexOf(text) + 1),
        "ROLLBACK TO SAVEPOINT kern_1",
        "RELEASE SAVEPOINT kern_1",
        "ROLLBACK",
      ])
      expect(releases).toEqual([{ connection: 1 }])
    })
  }
})

describe("abort signal of a test transaction", () => {
  /** Signal of a test and the function that aborts it with `reason`. */
  function createTestAbort() {
    const controller = new AbortController()
    const reason = new Error("test aborted")
    return { signal: controller.signal, reason, abort: () => controller.abort(reason) }
  }

  const settleNever = () => new Promise<never>(() => {})

  it("rejects with the reason of a signal aborted before the call without starting a transaction", async () => {
    const { coordinator, statements, releases } = createTestCoordinator()
    const reason = new Error("test aborted")

    let called = false
    const test = coordinator.testTransaction(
      async () => {
        called = true
      },
      { signal: AbortSignal.abort(reason) },
    )

    await expect(test).rejects.toBe(reason)
    expect(called).toBe(false)
    expect(statements).toEqual([])
    expect(releases).toEqual([])
  })

  // Orchid ORM rejected a cancelled start only in its turn, behind the rollback of a test whose statement still ran: https://github.com/romeerez/orchid-orm/pull/812
  it("rejects at once when aborted in the queue of the fixture stack, and never preempts the active level", async () => {
    const rollback = holdOn("ROLLBACK TO SAVEPOINT kern_1")
    const { coordinator, statements } = createTestCoordinator({ respond: rollback.respond })
    const { signal, reason, abort } = createTestAbort()
    const { promise: activeResumed, resolve: resumeActive } = Promise.withResolvers<void>()

    const fixture = await coordinator.createTestFixture(seedNothing)
    markHandled(coordinator.testTransaction(settleNever))
    await settleCallbacks()
    const active = coordinator.testTransaction(async () => {
      await activeResumed
      await coordinator.execute(createStatement("active"))
    })
    let called = false
    const aborted = coordinator.testTransaction(
      async () => {
        called = true
      },
      { signal },
    )
    await rollback.reached
    abort()

    await expect(aborted).rejects.toBe(reason)
    rollback.resume()
    await settleCallbacks()
    resumeActive()
    await active
    await fixture.close()
    expect(called).toBe(false)
    expect(statements.slice(3).map(({ text }) => text)).toEqual([
      "SAVEPOINT kern_1",
      "ROLLBACK TO SAVEPOINT kern_1",
      "RELEASE SAVEPOINT kern_1",
      "SAVEPOINT kern_1",
      "active",
      "ROLLBACK TO SAVEPOINT kern_1",
      "RELEASE SAVEPOINT kern_1",
      "ROLLBACK",
    ])
  })

  it("rejects at once when aborted while waiting for a connection, and releases the connection acquired later", async () => {
    const { promise: connectionFreed, resolve: freeConnection } = Promise.withResolvers<void>()
    const { coordinator, statements, releases } = createTestCoordinator({
      acquire: () => connectionFreed,
    })
    const { signal, reason, abort } = createTestAbort()

    let called = false
    const test = coordinator.testTransaction(
      async () => {
        called = true
      },
      { signal },
    )
    await settleCallbacks()
    abort()

    await expect(test).rejects.toBe(reason)
    freeConnection()
    await settleCallbacks()
    expect(called).toBe(false)
    expect(statements).toEqual([])
    expect(releases).toEqual([{ connection: 1 }])
  })

  it("ignores a failure to release the connection acquired after the abort", async () => {
    const { promise: connectionFreed, resolve: freeConnection } = Promise.withResolvers<void>()
    const { coordinator, releases } = createTestCoordinator({
      acquire: () => connectionFreed,
      release() {
        throw new Error("release")
      },
    })
    const { signal, reason, abort } = createTestAbort()
    const unhandled: unknown[] = []
    const recordUnhandled = (error: unknown) => unhandled.push(error)
    process.on("unhandledRejection", recordUnhandled)

    try {
      const test = coordinator.testTransaction(settleNever, { signal })
      await settleCallbacks()
      abort()

      await expect(test).rejects.toBe(reason)
      freeConnection()
      await settleCallbacks()
      expect(releases).toEqual([{ connection: 1 }])
      expect(unhandled).toEqual([])
    } finally {
      process.off("unhandledRejection", recordUnhandled)
    }
  })

  it("rejects at once when the signal aborts while the driver acquires the connection", async () => {
    const { promise: connectionFreed, resolve: freeConnection } = Promise.withResolvers<void>()
    const { signal, reason, abort } = createTestAbort()
    const { coordinator, statements, releases } = createTestCoordinator({
      acquire() {
        abort()
        return connectionFreed
      },
    })

    const test = coordinator.testTransaction(settleNever, { signal })

    await expect(test).rejects.toBe(reason)
    freeConnection()
    await settleCallbacks()
    expect(statements).toEqual([])
    expect(releases).toEqual([{ connection: 1 }])
  })

  it("starts nothing when aborted while the connection is handed over", async () => {
    const { coordinator, driver, statements, releases } = createTestCoordinator()
    const { signal, reason, abort } = createTestAbort()
    const { acquire } = driver
    driver.acquire = () => {
      const acquiring = acquire()
      // A reaction added after the one of the coordinator aborts after the connection is handed over and before it is used.
      queueMicrotask(() => void acquiring.then(abort))
      return acquiring
    }

    const test = coordinator.testTransaction(settleNever, { signal })

    await expect(test).rejects.toBe(reason)
    expect(statements).toEqual([])
    expect(releases).toEqual([{ connection: 1 }])
  })

  it("does not start its level when aborted while it preempts the active level", async () => {
    const rollback = holdOn("ROLLBACK TO SAVEPOINT kern_1")
    const { coordinator, statements } = createTestCoordinator({ respond: rollback.respond })
    const { signal, reason, abort } = createTestAbort()

    const fixture = await coordinator.createTestFixture(seedNothing)
    markHandled(coordinator.testTransaction(settleNever))
    await settleCallbacks()
    let called = false
    const test = markHandled(
      coordinator.testTransaction(
        async () => {
          called = true
        },
        { signal },
      ),
    )
    await rollback.reached
    abort()
    rollback.resume()

    await expect(test).rejects.toBe(reason)
    await fixture.close()
    expect(called).toBe(false)
    expect(statements.slice(3).map(({ text }) => text)).toEqual([
      "SAVEPOINT kern_1",
      "ROLLBACK TO SAVEPOINT kern_1",
      "RELEASE SAVEPOINT kern_1",
      "ROLLBACK",
    ])
  })

  it("ends a level aborted while its SAVEPOINT runs without calling its callback", async () => {
    const savepoint = holdOn("SAVEPOINT kern_1", 2)
    const { coordinator, statements } = createTestCoordinator({ respond: savepoint.respond })
    const { signal, reason, abort } = createTestAbort()

    const fixture = await coordinator.createTestFixture(seedNothing)
    let called = false
    const test = markHandled(
      coordinator.testTransaction(
        async () => {
          called = true
        },
        { signal },
      ),
    )
    await savepoint.reached
    abort()
    savepoint.resume()

    await expect(test).rejects.toBe(reason)
    await fixture.close()
    expect(called).toBe(false)
    expect(statements.slice(3).map(({ text }) => text)).toEqual([
      "SAVEPOINT kern_1",
      "ROLLBACK TO SAVEPOINT kern_1",
      "RELEASE SAVEPOINT kern_1",
      "ROLLBACK",
    ])
  })

  it("rolls back a transaction whose callback never settles once its sent statements complete, and rejects its later statements", async () => {
    const slow = holdOn("slow")
    const { coordinator, statements, releases } = createTestCoordinator({
      respond: slow.respond,
    })
    const { signal, reason, abort } = createTestAbort()
    const { promise: lateIssued, resolve: issueLate } = Promise.withResolvers<void>()

    let late: Promise<unknown> | undefined
    const test = markHandled(
      coordinator.testTransaction(
        async () => {
          void coordinator.execute(createStatement("slow"))
          await lateIssued
          late = markHandled(coordinator.execute(createStatement("late")))
          await settleNever()
        },
        { signal },
      ),
    )
    await slow.reached
    abort()
    issueLate()
    await settleCallbacks()

    await expect(late!).rejects.toThrow("its transaction is already finished")
    expect(releases).toEqual([])
    slow.resume()
    await expect(test).rejects.toBe(reason)
    expect(statements.map(({ connection, text }) => `${connection}: ${text}`)).toEqual([
      "1: BEGIN",
      "1: slow",
      "1: ROLLBACK",
    ])
    expect(releases).toEqual([{ connection: 1 }])
  })

  it("rolls back to its savepoint in a fixture before it rejects, and the next test runs in the fixture", async () => {
    const { coordinator, statements } = createTestCoordinator()
    const { signal, reason, abort } = createTestAbort()

    const fixture = await coordinator.createTestFixture(seedNothing)
    const test = markHandled(coordinator.testTransaction(settleNever, { signal }))
    await settleCallbacks()
    abort()

    await expect(test).rejects.toBe(reason)
    expect(statements.slice(3).map(({ text }) => text)).toEqual([
      "SAVEPOINT kern_1",
      "ROLLBACK TO SAVEPOINT kern_1",
      "RELEASE SAVEPOINT kern_1",
    ])
    await coordinator.testTransaction(run(coordinator, "next"))
    await fixture.close()
    expect(statements.slice(6).map(({ text }) => text)).toEqual([
      "SAVEPOINT kern_1",
      "next",
      "ROLLBACK TO SAVEPOINT kern_1",
      "RELEASE SAVEPOINT kern_1",
      "ROLLBACK",
    ])
  })

  it("rejects with the error of a callback that throws synchronously", async () => {
    const { coordinator, statements } = createTestCoordinator()
    const { signal } = createTestAbort()
    const failure = new Error("failure")

    const test = coordinator.testTransaction(
      () => {
        throw failure
      },
      { signal },
    )

    await expect(test).rejects.toBe(failure)
    expect(statements.map(({ text }) => text)).toEqual(["BEGIN", "ROLLBACK"])
  })

  it("ends the level when its callback aborts the signal before it returns", async () => {
    const { coordinator, statements, releases } = createTestCoordinator()
    const { signal, reason, abort } = createTestAbort()

    let late: Promise<unknown> | undefined
    const test = coordinator.testTransaction(
      async () => {
        abort()
        late = markHandled(coordinator.execute(createStatement("late")))
        await settleNever()
      },
      { signal },
    )

    await expect(test).rejects.toBe(reason)
    await expect(late!).rejects.toThrow("its transaction is already finished")
    expect(statements.map(({ text }) => text)).toEqual(["BEGIN", "ROLLBACK"])
    expect(releases).toEqual([{ connection: 1 }])
  })

  it("ends a nested test transaction and frees its enclosing transaction", async () => {
    const { coordinator, statements } = createTestCoordinator()
    const { signal, reason, abort } = createTestAbort()

    await coordinator.testTransaction(async () => {
      const nested = coordinator.testTransaction(settleNever, { signal })
      await settleCallbacks()
      abort()
      await expect(nested).rejects.toBe(reason)
      await coordinator.execute(createStatement("after"))
    })

    expect(statements.map(({ text }) => text)).toEqual([
      "BEGIN",
      "SAVEPOINT kern_1",
      "ROLLBACK TO SAVEPOINT kern_1",
      "RELEASE SAVEPOINT kern_1",
      "after",
      "ROLLBACK",
    ])
  })

  it("keeps the reason suppressed by a failed preemption that ends after the abort", async () => {
    const rollbackError = new Error("rollback")
    const rollback = holdOn("ROLLBACK TO SAVEPOINT kern_1", 1, rollbackError)
    const { coordinator } = createTestCoordinator({ respond: rollback.respond })
    const { signal, reason, abort } = createTestAbort()

    const fixture = await coordinator.createTestFixture(seedNothing)
    markHandled(coordinator.testTransaction(settleNever))
    await settleCallbacks()
    const test = coordinator.testTransaction(settleNever, { signal })
    await rollback.reached
    abort()
    rollback.resume()

    expect(await test.catch((error: unknown) => error)).toMatchObject({
      error: {
        message: expect.stringContaining("ending its active level failed"),
        cause: rollbackError,
      },
      suppressed: reason,
    })
    await fixture.close()
  })

  it("keeps the reason suppressed by a failed SAVEPOINT that completes after the abort", async () => {
    const savepointError = new Error("savepoint")
    const savepoint = holdOn("SAVEPOINT kern_1", 2, savepointError)
    const { coordinator } = createTestCoordinator({ respond: savepoint.respond })
    const { signal, reason, abort } = createTestAbort()

    const fixture = await coordinator.createTestFixture(seedNothing)
    const test = coordinator.testTransaction(settleNever, { signal })
    await savepoint.reached
    abort()
    savepoint.resume()

    expect(await test.catch((error: unknown) => error)).toMatchObject({
      error: savepointError,
      suppressed: reason,
    })
    await fixture.close()
  })

  it("keeps the reason suppressed by a failed BEGIN that completes after the abort, and releases the connection with the failure", async () => {
    const beginError = new Error("begin")
    const begin = holdOn("BEGIN", 1, beginError)
    const { coordinator, releases } = createTestCoordinator({ respond: begin.respond })
    const { signal, reason, abort } = createTestAbort()

    const test = coordinator.testTransaction(settleNever, { signal })
    await begin.reached
    abort()
    begin.resume()

    expect(await test.catch((error: unknown) => error)).toMatchObject({
      error: beginError,
      suppressed: reason,
    })
    expect(releases).toEqual([{ connection: 1, failure: { error: beginError } }])
  })

  it("keeps the reason suppressed by a failed ROLLBACK and releases the connection with the failure", async () => {
    const rollbackError = new Error("rollback")
    const { coordinator, releases } = createTestCoordinator({
      respond: failOn("ROLLBACK", rollbackError),
    })
    const { signal, reason, abort } = createTestAbort()

    const test = coordinator.testTransaction(settleNever, { signal })
    await settleCallbacks()
    abort()

    expect(await test.catch((error: unknown) => error)).toMatchObject({
      error: rollbackError,
      suppressed: reason,
    })
    expect(releases).toEqual([{ connection: 1, failure: { error: rollbackError } }])
  })

  it("resolves when the signal aborts right after its callback settles", async () => {
    const { coordinator, statements } = createTestCoordinator()
    const { signal, abort } = createTestAbort()
    const { promise: finished, resolve: finish } = Promise.withResolvers<string>()

    const test = coordinator.testTransaction(() => finished, { signal })
    await settleCallbacks()
    finish("done")
    await Promise.resolve()
    abort()

    expect(await test).toBe("done")
    expect(statements.map(({ text }) => text)).toEqual(["BEGIN", "ROLLBACK"])
  })
})

describe("failures of cleanup", () => {
  it("rejects with a failed BEGIN without running the callback", async () => {
    const beginError = new Error("begin")
    const { driver, statements, releases } = createRecordingDriver({
      respond: failOn("BEGIN", beginError),
    })
    const coordinator = new TransactionCoordinator(driver)

    let called = false
    const transaction = coordinator.transaction(async () => {
      called = true
    })

    await expect(transaction).rejects.toBe(beginError)
    expect(called).toBe(false)
    expect(statements.map(({ text }) => text)).toEqual(["BEGIN"])
    expect(releases).toEqual([{ connection: 1, failure: { error: beginError } }])
  })

  it("passes a failure with an undefined error to release", async () => {
    const { driver, releases } = createRecordingDriver({ respond: failOn("BEGIN", undefined) })
    const coordinator = new TransactionCoordinator(driver)

    await expect(coordinator.transaction(() => Promise.resolve())).rejects.toBeUndefined()
    expect(releases).toEqual([{ connection: 1, failure: { error: undefined } }])
  })

  it("rejects with a failed COMMIT and passes it to release", async () => {
    const commitError = new Error("commit")
    const { driver, statements, releases } = createRecordingDriver({
      respond: failOn("COMMIT", commitError),
    })
    const coordinator = new TransactionCoordinator(driver)

    await expect(coordinator.transaction(() => Promise.resolve("done"))).rejects.toBe(commitError)
    expect(statements.map(({ text }) => text)).toEqual(["BEGIN", "COMMIT"])
    expect(releases).toEqual([{ connection: 1, failure: { error: commitError } }])
  })

  it("keeps the callback error suppressed by a failed ROLLBACK", async () => {
    const callbackError = new Error("callback")
    const rollbackError = new Error("rollback")
    const { driver, releases } = createRecordingDriver({
      respond: failOn("ROLLBACK", rollbackError),
    })
    const coordinator = new TransactionCoordinator(driver)

    const rejection = await coordinator
      .transaction(() => Promise.reject(callbackError))
      .catch((error: unknown) => error)

    expect(rejection).toBeInstanceOf(SuppressedError)
    expect(rejection).toMatchObject({ error: rollbackError, suppressed: callbackError })
    expect(releases).toEqual([{ connection: 1, failure: { error: rollbackError } }])
  })

  it("keeps the earlier errors suppressed by a failed release", async () => {
    const callbackError = new Error("callback")
    const rollbackError = new Error("rollback")
    const releaseError = new Error("release")
    const { driver } = createRecordingDriver({
      respond: failOn("ROLLBACK", rollbackError),
      release() {
        throw releaseError
      },
    })
    const coordinator = new TransactionCoordinator(driver)

    const rejection = await coordinator
      .transaction(() => Promise.reject(callbackError))
      .catch((error: unknown) => error)

    expect(rejection).toMatchObject({
      error: releaseError,
      suppressed: { error: rollbackError, suppressed: callbackError },
    })
  })

  it("rejects with a failed release after a commit", async () => {
    const releaseError = new Error("release")
    const { driver } = createRecordingDriver({
      release: () => Promise.reject(releaseError),
    })
    const coordinator = new TransactionCoordinator(driver)

    await expect(coordinator.transaction(() => Promise.resolve("done"))).rejects.toBe(releaseError)
  })
})
