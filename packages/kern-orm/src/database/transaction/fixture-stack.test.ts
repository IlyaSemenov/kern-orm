import { describe, expect, it } from "bun:test"

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

  await expect(coordinator.createTestFixture(() => Promise.reject(failure))).rejects.toBe(failure)
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
  expect(releases).toEqual([{ connection: 1 }])
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
    expect(releases).toEqual([{ connection: 1 }])
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
    expect(releases).toEqual([{ connection: 1 }])
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

// Orchid ORM ran the later queries of a test whose savepoint an outer rollback ended in the enclosing test transaction: https://github.com/romeerez/orchid-orm/pull/816
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

// Orchid ORM preempted a test transaction whose nested transaction still ran (https://github.com/romeerez/orchid-orm/pull/833), and could roll the test back to a savepoint of the same name in it rather than its own (https://github.com/romeerez/orchid-orm/pull/814)
it("preempts a test transaction whose nested transaction still runs: rolls back both, and the later statements of the nested transaction fail", async () => {
  const { coordinator, statements } = createTestCoordinator()
  const { promise: nestedRunning, resolve: nestedStarted } = Promise.withResolvers<void>()
  const { promise: lateIssued, resolve: issueLate } = Promise.withResolvers<void>()

  const fixture = await coordinator.createTestFixture(seedNothing)
  let late: Promise<unknown> | undefined
  const preempted = markHandled(
    coordinator.testTransaction(async () => {
      await coordinator.execute(createStatement("test"))
      await coordinator.transaction(async () => {
        nestedStarted()
        await lateIssued
        late = markHandled(coordinator.execute(createStatement("late")))
      })
    }),
  )
  await nestedRunning
  await coordinator.testTransaction(run(coordinator, "next"))
  issueLate()

  await expect(preempted).rejects.toThrow("its test fixture started another level")
  await expect(late!).rejects.toThrow("transaction is already finished")
  await fixture.close()
  expect(statements.slice(3).map(({ text }) => text)).toEqual([
    "SAVEPOINT kern_1",
    "test",
    "SAVEPOINT kern_2",
    "ROLLBACK TO SAVEPOINT kern_2",
    "RELEASE SAVEPOINT kern_2",
    "ROLLBACK TO SAVEPOINT kern_1",
    "RELEASE SAVEPOINT kern_1",
    "SAVEPOINT kern_1",
    "next",
    "ROLLBACK TO SAVEPOINT kern_1",
    "RELEASE SAVEPOINT kern_1",
    "ROLLBACK",
  ])
})

// Orchid ORM ran a start and a rollback at once and left the state of the rollback in the next test: https://github.com/romeerez/orchid-orm/pull/809
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

// Orchid ORM never settled the start of a test transaction whose SAVEPOINT failed: https://github.com/romeerez/orchid-orm/pull/802
it("rejects a test transaction whose SAVEPOINT fails without calling its callback, and starts the next one in the fixture", async () => {
  const savepointError = new Error("savepoint")
  const { coordinator, statements } = createTestCoordinator({
    respond: failOn("SAVEPOINT kern_1", savepointError, 2),
  })

  const fixture = await coordinator.createTestFixture(seedNothing)
  let called = false
  const failed = coordinator.testTransaction(async () => {
    called = true
  })

  await expect(failed).rejects.toBe(savepointError)
  await coordinator.testTransaction(run(coordinator, "next"))
  await fixture.close()
  expect(called).toBe(false)
  expect(statements.slice(3).map(({ text }) => text)).toEqual([
    "SAVEPOINT kern_1",
    "SAVEPOINT kern_1",
    "next",
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

it("rejects with a failed BEGIN of the first fixture and releases its connection", async () => {
  const beginError = new Error("begin")
  const { coordinator, releases } = createTestCoordinator({
    respond: failOn("BEGIN", beginError),
  })

  await expect(coordinator.createTestFixture(seedNothing)).rejects.toBe(beginError)
  expect(releases).toEqual([{ connection: 1 }])
})

it("rejects with a failed ROLLBACK of the first fixture and releases its connection", async () => {
  const rollbackError = new Error("rollback")
  const { coordinator, releases } = createTestCoordinator({
    respond: failOn("ROLLBACK", rollbackError),
  })

  const fixture = await coordinator.createTestFixture(seedNothing)
  await expect(fixture.close()).rejects.toBe(rollbackError)
  expect(releases).toEqual([{ connection: 1 }])
})

it("closes the first fixture whose release fails, and reports the failure", async () => {
  const releaseError = new Error("release")
  const reported: unknown[] = []
  const { coordinator, releases } = createTestCoordinator(
    {
      release: () => Promise.reject(releaseError),
    },
    error => reported.push(error),
  )

  const fixture = await coordinator.createTestFixture(seedNothing)
  await fixture.close()

  expect(releases).toEqual([{ connection: 1 }])
  expect(reported).toEqual([releaseError])
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
  expect(releases).toEqual([{ connection: 1 }])
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

// Orchid ORM let a late rollback end the test transaction of the next test (https://github.com/romeerez/orchid-orm/pull/809) or route its queries to a rolled back one (https://github.com/romeerez/orchid-orm/pull/815)
it("keeps the next fixture open when a previous fixture or its child closes again", async () => {
  const { coordinator, statements } = createTestCoordinator()

  const root = await coordinator.createTestFixture(seedNothing)
  const file = await coordinator.createTestFixture(seedNothing)
  const closing = root.close()
  const next = coordinator.startTestFixture(() => Promise.resolve("next"))
  await Promise.all([closing, root.close(), file.close()])

  expect((await next.fixture).data).toBe("next")
  await coordinator.testTransaction(run(coordinator, "test"))
  await next.close()
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
    "2: BEGIN",
    "2: SAVEPOINT kern_1",
    "2: RELEASE SAVEPOINT kern_1",
    "2: SAVEPOINT kern_1",
    "2: test",
    "2: ROLLBACK TO SAVEPOINT kern_1",
    "2: RELEASE SAVEPOINT kern_1",
    "2: ROLLBACK",
  ])
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

  await expect(late.fixture).rejects.toThrow("Cannot create a test fixture: the database is closed")
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
