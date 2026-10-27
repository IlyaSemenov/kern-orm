import { describe, expect, it } from "bun:test"

import { createRecordingDriver } from "../../testing/recording-driver"

import { createDatabase } from "./database"
import { createStatement } from "./driver"
import type { TestHooks } from "./testing"
import { createTestHelpers } from "./testing"

/** Hooks of a test runner that the test calls itself. */
function createManualHooks() {
  const before: (() => Promise<void>)[] = []
  const after: (() => Promise<void>)[] = []
  const hooks: TestHooks = {
    before: hook => before.push(hook),
    after: hook => after.push(hook),
  }
  return { hooks, before, after }
}

function createTestDatabase() {
  const { driver, statements, releases } = createRecordingDriver()
  const database = createDatabase({ driver, test: true })
  const { hooks, before, after } = createManualHooks()
  return { database, statements, releases, before, after, ...createTestHelpers(database, hooks) }
}

it("rejects a database not created for tests", () => {
  const { driver } = createRecordingDriver()

  expect(() => createTestHelpers(createDatabase({ driver }), createManualHooks().hooks)).toThrow(
    "createTestHelpers requires a database created with test: true",
  )
})

describe("testTransaction", () => {
  it("rolls back a test transaction that resolves and returns its result", async () => {
    const { database, statements, releases, testTransaction } = createTestDatabase()

    const result = await testTransaction(async () => {
      await database.execute(createStatement("inside"))
      return "done"
    })

    expect(result).toBe("done")
    expect(statements.map(({ connection, text }) => `${connection}: ${text}`)).toEqual([
      "1: BEGIN",
      "1: inside",
      "1: ROLLBACK",
    ])
    expect(releases).toEqual([{ connection: 1 }])
  })

  it("runs transactions of the tested code nested in the test transaction", async () => {
    const { database, statements, testTransaction } = createTestDatabase()

    await testTransaction(() =>
      database.transaction(() => database.execute(createStatement("inside"))),
    )

    expect(statements.map(({ text }) => text)).toEqual([
      "BEGIN",
      "SAVEPOINT kern_1",
      "inside",
      "RELEASE SAVEPOINT kern_1",
      "ROLLBACK",
    ])
  })

  it("rolls back a nested test transaction to its savepoint", async () => {
    const { database, statements, testTransaction } = createTestDatabase()

    await testTransaction(async () => {
      await testTransaction(() => database.execute(createStatement("nested")))
      await database.execute(createStatement("after"))
    })

    expect(statements.map(({ text }) => text)).toEqual([
      "BEGIN",
      "SAVEPOINT kern_1",
      "nested",
      "ROLLBACK TO SAVEPOINT kern_1",
      "RELEASE SAVEPOINT kern_1",
      "after",
      "ROLLBACK",
    ])
  })

  it("gives every call its own transaction", async () => {
    const { database, statements, testTransaction } = createTestDatabase()

    await Promise.all([
      testTransaction(() => database.execute(createStatement("first"))),
      testTransaction(() => database.execute(createStatement("second"))),
    ])

    const connections = Object.fromEntries(
      statements.map(({ connection, text }) => [text, connection]),
    )
    expect(connections.first).not.toBe(connections.second)
  })

  // Orchid ORM ran such work in the next test or on the pool: https://github.com/romeerez/orchid-orm/issues/798
  it("rejects late work of a finished test transaction instead of running it in the next one", async () => {
    const { database, statements, testTransaction } = createTestDatabase()
    const { promise: nextStarted, resolve: startNext } = Promise.withResolvers<void>()

    let late: Promise<unknown> | undefined
    await testTransaction(async () => {
      late = nextStarted.then(() => database.execute(createStatement("late")))
    })
    await testTransaction(async () => {
      startNext()
      await expect(late!).rejects.toThrow("its transaction is already finished")
    })

    expect(statements.map(({ text }) => text)).not.toContain("late")
  })
})

describe("useTestFixture", () => {
  it("opens the fixture in the before hook and closes it in the after hook", async () => {
    const { database, statements, releases, before, after, testTransaction, useTestFixture } =
      createTestDatabase()

    const fixture = useTestFixture(async () => {
      await database.execute(createStatement("seed"))
      return { label: "seeded" }
    })

    expect(statements).toEqual([])
    expect(() => fixture.data).toThrow("Test fixture is not open")
    await before[0]!()
    expect(fixture.data).toEqual({ label: "seeded" })
    await testTransaction(() => database.execute(createStatement("test")))
    await after[0]!()
    expect(() => fixture.data).toThrow("Test fixture is not open")
    expect(statements.map(({ text }) => text)).toEqual([
      "BEGIN",
      "SAVEPOINT kern_1",
      "seed",
      "RELEASE SAVEPOINT kern_1",
      "SAVEPOINT kern_1",
      "test",
      "ROLLBACK TO SAVEPOINT kern_1",
      "RELEASE SAVEPOINT kern_1",
      "ROLLBACK",
    ])
    expect(releases).toEqual([{ connection: 1 }])
  })

  it("closes a fixture whose seed never settles before the next scope opens its fixture", async () => {
    const { database, statements, releases, before, after, useTestFixture } = createTestDatabase()
    const { promise: seeding, resolve: startSeed } = Promise.withResolvers<void>()
    const { promise: resumed, resolve: resume } = Promise.withResolvers<void>()

    let late: Promise<unknown> | undefined
    const stuck = useTestFixture(async () => {
      startSeed()
      late = resumed.then(() => database.execute(createStatement("late")))
      await new Promise<never>(() => {})
    })
    const next = useTestFixture(() => Promise.resolve("next"))

    // The runner gives up on the before hook of the first scope while its seed runs, closes the scope, and starts the next one.
    const stuckOpening = before[0]!()
    await seeding
    await Promise.all([stuckOpening, after[0]!(), before[1]!()])
    resume()

    await expect(late!).rejects.toThrow("its transaction is already finished")
    expect(() => stuck.data).toThrow("Test fixture is not open")
    expect(next.data).toBe("next")
    await after[1]!()
    expect(statements.map(({ connection, text }) => `${connection}: ${text}`)).toEqual([
      "1: BEGIN",
      "1: SAVEPOINT kern_1",
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

  it("rejects reading the data after an enclosing fixture closes", async () => {
    const { before, after, useTestFixture } = createTestDatabase()

    useTestFixture(() => Promise.resolve("enclosing"))
    const fixture = useTestFixture(() => Promise.resolve("nested"))
    await before[0]!()
    await before[1]!()
    // node:test runs the after hook of a preload module before the one of a test file.
    await after[0]!()

    expect(() => fixture.data).toThrow("Test fixture is closed")
    await after[1]!()
  })
})
