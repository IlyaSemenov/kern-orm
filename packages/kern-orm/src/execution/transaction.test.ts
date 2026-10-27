import { describe, expect, it } from "bun:test"

import type { SqlStatement } from "kern-orm"
import { createStatement } from "kern-orm"

import { createRecordingDriver } from "../../testing/recording-driver"

import { TransactionCoordinator } from "./transaction"

/** Marks the rejection of `promise` as handled, so that a test can inspect it after it settles. */
function markHandled<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {})
  return promise
}

/** Waits until pending promise callbacks run, such as the end of a transaction whose callback has settled. */
function settleCallbacks(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve))
}

/** Response that fails `text` with `error` and answers other statements. */
function failOn(text: string, error: unknown) {
  return (statement: SqlStatement) => {
    if (statement.text === text) {
      throw error
    }
    return {}
  }
}

/** Response that holds the statement `text`, or its later `occurrence`, until `resume` is called and reports when it is reached. */
function holdOn(text: string, occurrence = 1) {
  const reached = Promise.withResolvers<void>()
  const resumed = Promise.withResolvers<void>()
  let seen = 0
  return {
    async respond(statement: SqlStatement) {
      if (statement.text === text && ++seen === occurrence) {
        reached.resolve()
        await resumed.promise
      }
      return {}
    },
    reached: reached.promise,
    resume: () => resumed.resolve(),
  }
}

describe("TransactionCoordinator", () => {
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
      const { promise: grandchildRunning, resolve: grandchildStarted } =
        Promise.withResolvers<void>()
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

  describe("test fixtures", () => {
    function createTestCoordinator(options?: Parameters<typeof createRecordingDriver>[0]) {
      const recording = createRecordingDriver(options)
      return { ...recording, coordinator: new TransactionCoordinator(recording.driver, true) }
    }

    function run(coordinator: TransactionCoordinator, text: string) {
      return () => coordinator.execute(createStatement(text)).then(() => undefined)
    }

    const seedNothing = () => Promise.resolve()

    it("runs test transactions in the innermost fixture and keeps its seeded changes until it closes", async () => {
      const { coordinator, statements, releases } = createTestCoordinator()

      const root = await coordinator.createTestFixture(async () => {
        await coordinator.execute(createStatement("migrate"))
        return "migrated"
      })
      expect(root.data).toBe("migrated")
      await coordinator.testTransaction(run(coordinator, "test 1"))
      const file = await coordinator.createTestFixture(run(coordinator, "file data"))
      await coordinator.testTransaction(run(coordinator, "test 2"))
      await file.close()
      await coordinator.testTransaction(run(coordinator, "test 3"))
      await root.close()

      expect(statements.map(({ connection, text }) => `${connection}: ${text}`)).toEqual([
        "1: BEGIN",
        "1: SAVEPOINT kern_1",
        "1: migrate",
        "1: RELEASE SAVEPOINT kern_1",
        "1: SAVEPOINT kern_1",
        "1: test 1",
        "1: ROLLBACK TO SAVEPOINT kern_1",
        "1: RELEASE SAVEPOINT kern_1",
        "1: SAVEPOINT kern_1",
        "1: SAVEPOINT kern_2",
        "1: file data",
        "1: RELEASE SAVEPOINT kern_2",
        "1: SAVEPOINT kern_2",
        "1: test 2",
        "1: ROLLBACK TO SAVEPOINT kern_2",
        "1: RELEASE SAVEPOINT kern_2",
        "1: ROLLBACK TO SAVEPOINT kern_1",
        "1: RELEASE SAVEPOINT kern_1",
        "1: SAVEPOINT kern_1",
        "1: test 3",
        "1: ROLLBACK TO SAVEPOINT kern_1",
        "1: RELEASE SAVEPOINT kern_1",
        "1: ROLLBACK",
      ])
      expect(releases).toEqual([{ connection: 1 }])
    })

    it("rolls back and closes a fixture whose seed rejects", async () => {
      const { coordinator, statements, releases } = createTestCoordinator()
      const failure = new Error("failure")

      await expect(coordinator.createTestFixture(() => Promise.reject(failure))).rejects.toBe(
        failure,
      )
      await coordinator.testTransaction(run(coordinator, "test"))

      expect(statements.map(({ connection, text }) => `${connection}: ${text}`)).toEqual([
        "1: BEGIN",
        "1: SAVEPOINT kern_1",
        "1: ROLLBACK TO SAVEPOINT kern_1",
        "1: RELEASE SAVEPOINT kern_1",
        "1: ROLLBACK",
        "2: BEGIN",
        "2: test",
        "2: ROLLBACK",
      ])
      expect(releases).toEqual([{ connection: 1 }, { connection: 2 }])
    })

    it("rejects with a failed SAVEPOINT of the seed and releases the connection of the fixture", async () => {
      const savepointError = new Error("savepoint")
      const { coordinator, statements, releases } = createTestCoordinator({
        respond: failOn("SAVEPOINT kern_1", savepointError),
      })

      await expect(coordinator.createTestFixture(seedNothing)).rejects.toBe(savepointError)
      await coordinator.testTransaction(run(coordinator, "test"))

      expect(statements.map(({ connection, text }) => `${connection}: ${text}`)).toEqual([
        "1: BEGIN",
        "1: SAVEPOINT kern_1",
        "1: ROLLBACK",
        "2: BEGIN",
        "2: test",
        "2: ROLLBACK",
      ])
      expect(releases).toEqual([{ connection: 1 }, { connection: 2 }])
    })

    it("rejects with a failed RELEASE of the seed and closes the fixture", async () => {
      const releaseError = new Error("release")
      const { coordinator, statements, releases } = createTestCoordinator({
        respond: failOn("RELEASE SAVEPOINT kern_1", releaseError),
      })

      await expect(coordinator.createTestFixture(seedNothing)).rejects.toBe(releaseError)

      expect(statements.map(({ text }) => text)).toEqual([
        "BEGIN",
        "SAVEPOINT kern_1",
        "RELEASE SAVEPOINT kern_1",
        "ROLLBACK",
      ])
      expect(releases).toEqual([{ connection: 1 }])
    })

    it("keeps both errors when a fixture whose seed rejects fails to roll back", async () => {
      const failure = new Error("failure")
      const rollbackError = new Error("rollback")
      const { coordinator, releases } = createTestCoordinator({
        respond: failOn("ROLLBACK", rollbackError),
      })

      const rejection = await coordinator
        .createTestFixture(() => Promise.reject(failure))
        .catch((error: unknown) => error)

      expect(rejection).toMatchObject({ error: rollbackError, suppressed: failure })
      expect(releases).toEqual([{ connection: 1, failure: { error: rollbackError } }])
    })

    it("rejects closing a fixture inside the seed of another one instead of waiting forever", async () => {
      const { coordinator, statements, releases } = createTestCoordinator()

      const root = await coordinator.createTestFixture(seedNothing)
      await expect(coordinator.createTestFixture(() => root.close())).rejects.toThrow(
        "Cannot close a test fixture inside a transaction",
      )
      await root.close()

      expect(statements.map(({ text }) => text)).toEqual([
        "BEGIN",
        "SAVEPOINT kern_1",
        "RELEASE SAVEPOINT kern_1",
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

    describe("closing before the fixture opens", () => {
      it("does not start a fixture closed while its opening is queued", async () => {
        const { coordinator, statements } = createTestCoordinator()

        const pending = coordinator.startTestFixture(run(coordinator, "seed"))
        await pending.close()

        await expect(pending.fixture).rejects.toThrow("Test fixture was closed before it opened")
        expect(statements).toEqual([])
      })

      it("rolls back the fixture without waiting for its seed", async () => {
        const { coordinator, statements, releases } = createTestCoordinator()
        const { promise: seeding, resolve: startSeed } = Promise.withResolvers<void>()

        const pending = coordinator.startTestFixture(async () => {
          await coordinator.execute(createStatement("seed"))
          startSeed()
          await new Promise<never>(() => {})
        })
        await seeding
        await pending.close()
        await expect(pending.fixture).rejects.toThrow("Test fixture was closed before it opened")
        await coordinator.testTransaction(run(coordinator, "test"))

        expect(statements.map(({ connection, text }) => `${connection}: ${text}`)).toEqual([
          "1: BEGIN",
          "1: SAVEPOINT kern_1",
          "1: seed",
          "1: ROLLBACK TO SAVEPOINT kern_1",
          "1: RELEASE SAVEPOINT kern_1",
          "1: ROLLBACK",
          "2: BEGIN",
          "2: test",
          "2: ROLLBACK",
        ])
        expect(releases).toEqual([{ connection: 1 }, { connection: 2 }])
      })

      it("rejects closing with a failed rollback of the fixture", async () => {
        const rollbackError = new Error("rollback")
        const { coordinator, releases } = createTestCoordinator({
          respond: failOn("ROLLBACK", rollbackError),
        })
        const { promise: seeding, resolve: startSeed } = Promise.withResolvers<void>()

        const pending = coordinator.startTestFixture(() => {
          startSeed()
          return new Promise<never>(() => {})
        })
        markHandled(pending.fixture)
        await seeding

        await expect(pending.close()).rejects.toBe(rollbackError)
        await expect(pending.close()).resolves.toBeUndefined()
        expect(releases).toEqual([{ connection: 1, failure: { error: rollbackError } }])
      })

      it("rejects closing with a failed BEGIN of the fixture", async () => {
        const beginError = new Error("begin")
        const begin = holdOn("BEGIN")
        const { coordinator, releases } = createTestCoordinator({
          async respond(statement) {
            await begin.respond(statement)
            if (statement.text === "BEGIN") {
              throw beginError
            }
            return {}
          },
        })

        const pending = coordinator.startTestFixture(seedNothing)
        await begin.reached
        const closing = pending.close()
        begin.resume()

        await expect(closing).rejects.toBe(beginError)
        await expect(pending.fixture).rejects.toThrow("Test fixture was closed before it opened")
        expect(releases).toEqual([{ connection: 1, failure: { error: beginError } }])
      })

      it("rejects closing with the seed rejection and the failed rollback of a fixture whose seed rejected before closing", async () => {
        const rollbackError = new Error("rollback")
        const rollback = holdOn("ROLLBACK")
        const { coordinator } = createTestCoordinator({
          async respond(statement) {
            await rollback.respond(statement)
            if (statement.text === "ROLLBACK") {
              throw rollbackError
            }
            return {}
          },
        })

        const failure = new Error("failure")
        const pending = coordinator.startTestFixture(() => Promise.reject(failure))
        await rollback.reached
        const closing = pending.close()
        rollback.resume()

        expect(await closing.catch((error: unknown) => error)).toMatchObject({
          error: rollbackError,
          suppressed: failure,
        })
        await expect(pending.fixture).rejects.toThrow("Test fixture was closed before it opened")
      })
    })

    it("preempts an active test transaction: its sent statements complete before its rollback, and its later statements fail", async () => {
      const slow = holdOn("slow")
      const { coordinator, statements } = createTestCoordinator({ respond: slow.respond })
      const { promise: lateIssued, resolve: issueLate } = Promise.withResolvers<void>()

      const fixture = await coordinator.createTestFixture(seedNothing)
      let late: Promise<unknown> | undefined
      const preempted = markHandled(
        coordinator.testTransaction(async () => {
          await coordinator.execute(createStatement("slow"))
          await lateIssued
          late = markHandled(coordinator.execute(createStatement("late")))
        }),
      )
      await slow.reached
      const next = coordinator.testTransaction(run(coordinator, "next"))
      await settleCallbacks()
      slow.resume()
      await next
      issueLate()

      await expect(preempted).rejects.toThrow(
        "its test fixture started another level before it finished",
      )
      await expect(late!).rejects.toThrow("transaction is already finished")
      await fixture.close()
      expect(statements.slice(3).map(({ text }) => text)).toEqual([
        "SAVEPOINT kern_1",
        "slow",
        "ROLLBACK TO SAVEPOINT kern_1",
        "RELEASE SAVEPOINT kern_1",
        "SAVEPOINT kern_1",
        "next",
        "ROLLBACK TO SAVEPOINT kern_1",
        "RELEASE SAVEPOINT kern_1",
        "ROLLBACK",
      ])
    })

    it("starts levels one after another while a preemption is held", async () => {
      const rollback = holdOn("ROLLBACK TO SAVEPOINT kern_1")
      const { coordinator, statements } = createTestCoordinator({ respond: rollback.respond })
      const { promise: finished, resolve: finish } = Promise.withResolvers<void>()

      const fixture = await coordinator.createTestFixture(seedNothing)
      const transaction1 = markHandled(coordinator.testTransaction(() => finished))
      await settleCallbacks()
      const transaction2 = markHandled(coordinator.testTransaction(() => finished))
      const transaction3 = coordinator.testTransaction(run(coordinator, "transaction 3"))
      await rollback.reached
      await settleCallbacks()
      rollback.resume()

      await transaction3
      finish()
      await expect(transaction1).rejects.toThrow("its test fixture started another level")
      await expect(transaction2).rejects.toThrow("its test fixture started another level")
      await fixture.close()
      expect(statements.slice(3).map(({ text }) => text)).toEqual([
        "SAVEPOINT kern_1",
        "ROLLBACK TO SAVEPOINT kern_1",
        "RELEASE SAVEPOINT kern_1",
        "SAVEPOINT kern_1",
        "ROLLBACK TO SAVEPOINT kern_1",
        "RELEASE SAVEPOINT kern_1",
        "SAVEPOINT kern_1",
        "transaction 3",
        "ROLLBACK TO SAVEPOINT kern_1",
        "RELEASE SAVEPOINT kern_1",
        "ROLLBACK",
      ])
    })

    it("starts a test transaction in a fixture whose seed runs", async () => {
      const seed = holdOn("file data")
      const { coordinator, statements } = createTestCoordinator({ respond: seed.respond })

      const root = await coordinator.createTestFixture(seedNothing)
      const file = coordinator.createTestFixture(run(coordinator, "file data"))
      await seed.reached
      const test = coordinator.testTransaction(run(coordinator, "test"))
      await settleCallbacks()
      seed.resume()
      await test
      await (await file).close()
      await root.close()

      expect(statements.slice(3).map(({ text }) => text)).toEqual([
        "SAVEPOINT kern_1",
        "SAVEPOINT kern_2",
        "file data",
        "RELEASE SAVEPOINT kern_2",
        "SAVEPOINT kern_2",
        "test",
        "ROLLBACK TO SAVEPOINT kern_2",
        "RELEASE SAVEPOINT kern_2",
        "ROLLBACK TO SAVEPOINT kern_1",
        "RELEASE SAVEPOINT kern_1",
        "ROLLBACK",
      ])
    })

    it("creates one transaction for fixtures created while its BEGIN runs", async () => {
      const begin = holdOn("BEGIN")
      const { coordinator, statements, releases } = createTestCoordinator({
        respond: begin.respond,
      })

      const root = coordinator.createTestFixture(seedNothing)
      const file = coordinator.createTestFixture(seedNothing)
      await begin.reached
      begin.resume()
      await (await file).close()
      await (await root).close()

      expect(statements.map(({ connection, text }) => `${connection}: ${text}`)).toEqual([
        "1: BEGIN",
        "1: SAVEPOINT kern_1",
        "1: RELEASE SAVEPOINT kern_1",
        "1: SAVEPOINT kern_1",
        "1: SAVEPOINT kern_2",
        "1: RELEASE SAVEPOINT kern_2",
        "1: ROLLBACK TO SAVEPOINT kern_1",
        "1: RELEASE SAVEPOINT kern_1",
        "1: ROLLBACK",
      ])
      expect(releases).toEqual([{ connection: 1 }])
    })

    it("ends a test transaction that started before its fixture closes", async () => {
      const savepoint = holdOn("SAVEPOINT kern_1", 2)
      const { coordinator, statements, releases } = createTestCoordinator({
        respond: savepoint.respond,
      })

      const fixture = await coordinator.createTestFixture(seedNothing)
      const { promise: finished, resolve: finish } = Promise.withResolvers<void>()
      const test = markHandled(coordinator.testTransaction(() => finished))
      await savepoint.reached
      const closed = fixture.close()
      await settleCallbacks()
      savepoint.resume()
      await closed
      finish()

      await expect(test).rejects.toThrow("its enclosing transaction ended first")
      expect(statements.slice(3).map(({ text }) => text)).toEqual([
        "SAVEPOINT kern_1",
        "ROLLBACK TO SAVEPOINT kern_1",
        "RELEASE SAVEPOINT kern_1",
        "ROLLBACK",
      ])
      expect(releases).toEqual([{ connection: 1 }])
    })

    it("poisons a fixture whose preemption fails to roll back, and still closes it", async () => {
      const rollbackError = new Error("rollback")
      const { coordinator, statements, releases } = createTestCoordinator({
        respond: failOn("ROLLBACK TO SAVEPOINT kern_1", rollbackError),
      })
      const { promise: finished } = Promise.withResolvers<void>()

      const fixture = await coordinator.createTestFixture(seedNothing)
      markHandled(coordinator.testTransaction(() => finished))
      await settleCallbacks()

      expect(
        await coordinator.testTransaction(() => Promise.resolve()).catch((error: unknown) => error),
      ).toMatchObject({
        message: expect.stringContaining("ending its active level failed"),
        cause: rollbackError,
      })
      expect(
        await coordinator.createTestFixture(seedNothing).catch((error: unknown) => error),
      ).toMatchObject({
        message: expect.stringContaining("the transaction can only roll back"),
        cause: rollbackError,
      })
      await fixture.close()
      expect(statements.slice(3).map(({ text }) => text)).toEqual([
        "SAVEPOINT kern_1",
        "ROLLBACK TO SAVEPOINT kern_1",
        "ROLLBACK",
      ])
      expect(releases).toEqual([{ connection: 1 }])
    })

    it("reports a failure to roll back a level nested in a preempted one and keeps the fixture usable", async () => {
      const rollbackError = new Error("rollback")
      const { coordinator, statements } = createTestCoordinator({
        respond: failOn("ROLLBACK TO SAVEPOINT kern_2", rollbackError),
      })
      const { promise: finished } = Promise.withResolvers<void>()
      const { promise: nestedRunning, resolve: nestedStarted } = Promise.withResolvers<void>()

      const fixture = await coordinator.createTestFixture(seedNothing)
      markHandled(
        coordinator.testTransaction(() =>
          coordinator.transaction(() => {
            nestedStarted()
            return finished
          }),
        ),
      )
      await nestedRunning

      expect(
        await coordinator.testTransaction(() => Promise.resolve()).catch((error: unknown) => error),
      ).toMatchObject({
        message: expect.stringContaining("ending its active level failed"),
        cause: rollbackError,
      })
      await coordinator.testTransaction(run(coordinator, "next"))
      await fixture.close()
      expect(statements.slice(3).map(({ text }) => text)).toEqual([
        "SAVEPOINT kern_1",
        "SAVEPOINT kern_2",
        "ROLLBACK TO SAVEPOINT kern_2",
        "ROLLBACK TO SAVEPOINT kern_1",
        "RELEASE SAVEPOINT kern_1",
        "SAVEPOINT kern_1",
        "next",
        "ROLLBACK TO SAVEPOINT kern_1",
        "RELEASE SAVEPOINT kern_1",
        "ROLLBACK",
      ])
    })

    it("rejects with a failed BEGIN of the first fixture and releases its connection with the failure", async () => {
      const beginError = new Error("begin")
      const { coordinator, releases } = createTestCoordinator({
        respond: failOn("BEGIN", beginError),
      })

      await expect(coordinator.createTestFixture(seedNothing)).rejects.toBe(beginError)
      expect(releases).toEqual([{ connection: 1, failure: { error: beginError } }])
    })

    it("rejects with a failed ROLLBACK of the first fixture and releases its connection with the failure", async () => {
      const rollbackError = new Error("rollback")
      const { coordinator, releases } = createTestCoordinator({
        respond: failOn("ROLLBACK", rollbackError),
      })

      const fixture = await coordinator.createTestFixture(seedNothing)
      await expect(fixture.close()).rejects.toBe(rollbackError)
      expect(releases).toEqual([{ connection: 1, failure: { error: rollbackError } }])
    })

    it("poisons the enclosing fixture when a nested one fails to close, and recovers by closing it", async () => {
      const rollbackError = new Error("rollback")
      const { coordinator, statements, releases } = createTestCoordinator({
        respond: failOn("ROLLBACK TO SAVEPOINT kern_1", rollbackError),
      })

      const root = await coordinator.createTestFixture(seedNothing)
      const file = await coordinator.createTestFixture(seedNothing)
      await expect(file.close()).rejects.toBe(rollbackError)
      await expect(coordinator.testTransaction(() => Promise.resolve())).rejects.toThrow(
        "the transaction can only roll back",
      )
      await root.close()

      expect(statements.slice(3).map(({ text }) => text)).toEqual([
        "SAVEPOINT kern_1",
        "SAVEPOINT kern_2",
        "RELEASE SAVEPOINT kern_2",
        "ROLLBACK TO SAVEPOINT kern_1",
        "ROLLBACK",
      ])
      expect(releases).toEqual([{ connection: 1 }])
    })

    it("closes the fixtures and the test transaction nested in a closed fixture, and closing again does nothing", async () => {
      const { coordinator, statements, releases } = createTestCoordinator()
      const { promise: finished, resolve: finish } = Promise.withResolvers<void>()
      const { promise: running, resolve: started } = Promise.withResolvers<void>()

      const root = await coordinator.createTestFixture(seedNothing)
      const file = await coordinator.createTestFixture(seedNothing)
      const test = markHandled(
        coordinator.testTransaction(() => {
          started()
          return finished
        }),
      )
      await running
      await root.close()
      await file.close()
      await root.close()
      finish()
      await expect(test).rejects.toThrow("its enclosing transaction ended first")
      const next = await coordinator.createTestFixture(seedNothing)
      await root.close()
      await next.close()

      expect(statements.slice(6).map(({ connection, text }) => `${connection}: ${text}`)).toEqual([
        "1: SAVEPOINT kern_2",
        "1: ROLLBACK TO SAVEPOINT kern_2",
        "1: RELEASE SAVEPOINT kern_2",
        "1: ROLLBACK TO SAVEPOINT kern_1",
        "1: RELEASE SAVEPOINT kern_1",
        "1: ROLLBACK",
        "2: BEGIN",
        "2: SAVEPOINT kern_1",
        "2: RELEASE SAVEPOINT kern_1",
        "2: ROLLBACK",
      ])
      expect(releases).toEqual([{ connection: 1 }, { connection: 2 }])
    })

    it("rejects reading the data of a closed fixture, including one closed with an enclosing fixture", async () => {
      const { coordinator } = createTestCoordinator()

      const root = await coordinator.createTestFixture(() => Promise.resolve("root"))
      const file = await coordinator.createTestFixture(() => Promise.resolve("file"))
      expect(file.data).toBe("file")
      await root.close()

      expect(() => root.data).toThrow("Test fixture is closed")
      expect(() => file.data).toThrow("Test fixture is closed")
    })

    it("finishes closing, including the release, before a repeated close or a new fixture", async () => {
      const { promise: released, resolve: release } = Promise.withResolvers<void>()
      const { promise: releasing, resolve: startRelease } = Promise.withResolvers<void>()
      const { coordinator, releases } = createTestCoordinator({
        release() {
          startRelease()
          return released
        },
      })
      const settled: string[] = []

      const root = await coordinator.createTestFixture(seedNothing)
      const closing = root.close().then(() => settled.push("close"))
      // The fixture is already closed while its connection is being released.
      await releasing
      const again = root.close().then(() => settled.push("close again"))
      const next = coordinator
        .createTestFixture(seedNothing)
        .then(fixture => (settled.push("next"), fixture))
      await settleCallbacks()
      expect(settled).toEqual([])

      release()
      await Promise.all([closing, again])
      await (await next).close()

      expect(settled).toEqual(["close", "close again", "next"])
      expect(releases).toEqual([{ connection: 1 }, { connection: 2 }])
    })

    it("keeps closing after a failure in the cascade and reports every failure", async () => {
      const nestedError = new Error("nested rollback")
      const rootError = new Error("rollback")
      const { coordinator, releases } = createTestCoordinator({
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

      const root = await coordinator.createTestFixture(seedNothing)
      await coordinator.createTestFixture(seedNothing)
      const rejection = await root.close().catch((error: unknown) => error)

      expect(rejection).toMatchObject({ error: rootError, suppressed: nestedError })
      expect(releases).toEqual([{ connection: 1, failure: { error: rootError } }])
      await root.close()
    })

    it("closes a fixture whose seed never settles when its parent closes", async () => {
      const { coordinator, statements, releases } = createTestCoordinator()
      const { promise: seeding, resolve: startSeed } = Promise.withResolvers<void>()

      const root = await coordinator.createTestFixture(seedNothing)
      const file = coordinator.startTestFixture(() => {
        startSeed()
        return new Promise<never>(() => {})
      })
      markHandled(file.fixture)
      await seeding
      // node:test runs the after hook of a preload module before the one of a test file.
      await root.close()
      await file.close()

      await expect(file.fixture).rejects.toThrow("Test fixture was closed before it opened")
      expect(statements.slice(3).map(({ text }) => text)).toEqual([
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

    it("keeps the next fixture open when a previous fixture or its child closes again", async () => {
      const { coordinator } = createTestCoordinator()

      const root = await coordinator.createTestFixture(seedNothing)
      const file = await coordinator.createTestFixture(seedNothing)
      const closing = root.close()
      const next = coordinator.startTestFixture(() => Promise.resolve("next"))
      await Promise.all([closing, root.close(), file.close()])

      expect((await next.fixture).data).toBe("next")
      await next.close()
    })

    it("rolls back the open fixtures before closing the driver", async () => {
      const { coordinator, driver, statements, releases } = createTestCoordinator()
      let closedAfter: string[] | undefined
      driver.close = () => {
        closedAfter = statements.map(({ text }) => text)
        return Promise.resolve()
      }

      const root = await coordinator.createTestFixture(seedNothing)
      await coordinator.createTestFixture(seedNothing)
      await coordinator.close()

      expect(closedAfter).toEqual([
        "BEGIN",
        "SAVEPOINT kern_1",
        "RELEASE SAVEPOINT kern_1",
        "SAVEPOINT kern_1",
        "SAVEPOINT kern_2",
        "RELEASE SAVEPOINT kern_2",
        "ROLLBACK TO SAVEPOINT kern_1",
        "RELEASE SAVEPOINT kern_1",
        "ROLLBACK",
      ])
      expect(releases).toEqual([{ connection: 1 }])
      expect(() => root.data).toThrow("Test fixture is closed")
    })

    it("closes a fixture whose seed never settles before closing the driver", async () => {
      const { coordinator, driver, statements, releases } = createTestCoordinator()
      const { promise: seeding, resolve: startSeed } = Promise.withResolvers<void>()
      let closedAfter: string[] | undefined
      driver.close = () => {
        closedAfter = statements.map(({ text }) => text)
        return Promise.resolve()
      }

      const pending = coordinator.startTestFixture(() => {
        startSeed()
        return new Promise<never>(() => {})
      })
      markHandled(pending.fixture)
      await seeding
      await coordinator.close()

      expect(closedAfter).toEqual([
        "BEGIN",
        "SAVEPOINT kern_1",
        "ROLLBACK TO SAVEPOINT kern_1",
        "RELEASE SAVEPOINT kern_1",
        "ROLLBACK",
      ])
      expect(releases).toEqual([{ connection: 1 }])
    })

    it("rejects fixtures and test transactions started after closing is requested", async () => {
      const { coordinator, statements, releases } = createTestCoordinator()

      await coordinator.createTestFixture(seedNothing)
      const closing = coordinator.close()
      const late = coordinator.startTestFixture(run(coordinator, "late seed"))

      await expect(late.fixture).rejects.toThrow(
        "Cannot create a test fixture: the database is closed",
      )
      await expect(coordinator.testTransaction(seedNothing)).rejects.toThrow(
        "Cannot start a test transaction: the database is closed",
      )
      await late.close()
      await closing
      expect(statements.map(({ connection, text }) => `${connection}: ${text}`)).toEqual([
        "1: BEGIN",
        "1: SAVEPOINT kern_1",
        "1: RELEASE SAVEPOINT kern_1",
        "1: ROLLBACK",
      ])
      expect(releases).toEqual([{ connection: 1 }])
    })

    it("keeps a failure to close a fixture suppressed by a failure to close the driver", async () => {
      const rollbackError = new Error("rollback")
      const driverError = new Error("driver")
      const { coordinator, driver } = createTestCoordinator({
        respond: failOn("ROLLBACK", rollbackError),
      })
      driver.close = () => Promise.reject(driverError)

      await coordinator.createTestFixture(seedNothing)
      const rejection = await coordinator.close().catch((error: unknown) => error)

      expect(rejection).toMatchObject({ error: driverError, suppressed: rollbackError })
    })

    it("rejects creating a fixture inside a transaction, including a finished one", async () => {
      const { coordinator, statements } = createTestCoordinator()
      const { promise: ended, resolve: end } = Promise.withResolvers<void>()

      const fixture = await coordinator.createTestFixture(seedNothing)
      let late: Promise<unknown> | undefined
      await coordinator.testTransaction(async () => {
        await expect(coordinator.createTestFixture(seedNothing)).rejects.toThrow(
          "Cannot create a test fixture inside a transaction",
        )
        late = ended.then(() => coordinator.createTestFixture(run(coordinator, "late seed")))
      })
      end()

      await expect(late!).rejects.toThrow("Cannot create a test fixture inside a transaction")
      await fixture.close()
      expect(statements.map(({ text }) => text)).not.toContain("late seed")
    })

    it("rejects test transactions and fixtures of a coordinator not created for tests", async () => {
      const { driver, statements } = createRecordingDriver()
      const coordinator = new TransactionCoordinator(driver)

      await expect(coordinator.testTransaction(() => Promise.resolve())).rejects.toThrow(
        "testTransaction requires a database created with test: true",
      )
      await expect(coordinator.createTestFixture(seedNothing)).rejects.toThrow(
        "createTestFixture requires a database created with test: true",
      )
      expect(statements).toEqual([])
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

      await expect(coordinator.transaction(() => Promise.resolve("done"))).rejects.toBe(
        releaseError,
      )
    })
  })
})
