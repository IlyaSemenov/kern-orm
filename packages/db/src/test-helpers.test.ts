import { describe, expect, it } from "bun:test"

import { describePostgres } from "@kern-orm/test-harness/postgres"
import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"

import { createDatabase } from "./database"
import { createStatement } from "./driver"
import type { TestHooks } from "./test-helpers"
import { createTestHelpers, openTestFixture, openTestTransaction } from "./test-helpers"
import * as t from "./types"

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

it("rejects an object that createDatabase did not create, such as a copy of a database", () => {
  const { driver } = createRecordingDriver()
  const database = createDatabase({ driver, test: true })

  expect(() => createTestHelpers({ ...database }, createManualHooks().hooks)).toThrow(
    "The database was not created by createDatabase of this copy of the package",
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
      "1: SAVEPOINT kern_1",
      "1: inside",
      "1: RELEASE SAVEPOINT kern_1",
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
      "SAVEPOINT kern_2",
      "nested",
      "RELEASE SAVEPOINT kern_2",
      "ROLLBACK TO SAVEPOINT kern_1",
      "RELEASE SAVEPOINT kern_1",
      "SAVEPOINT kern_1",
      "after",
      "RELEASE SAVEPOINT kern_1",
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

describePostgres(
  "test transactions in PostgreSQL",
  ({ database, testTransaction, useTestFixture }) => {
    useTestFixture(() => database.script("CREATE TABLE test_run (id integer)"))

    // Orchid ORM failed every later test of the file once a statement failed in its test transaction: https://github.com/romeerez/orchid-orm/pull/802
    it("runs the next test of the fixture after a statement of a test fails", async () => {
      await expect(testTransaction(() => database.script("SELECT 1 / 0"))).rejects.toThrow(
        "division by zero",
      )
      await testTransaction(() => database.script("INSERT INTO test_run VALUES (1)"))
    })

    it("keeps the changes of a test and runs its later statements after a statement of the tested code fails", async () => {
      const count = await testTransaction(async () => {
        await database.script("INSERT INTO test_run VALUES (1)")
        await expect(database.script("SELECT 1 / 0")).rejects.toThrow("division by zero")
        await database.script("INSERT INTO test_run VALUES (2)")
        return await database.query`SELECT count(*) FROM test_run`.get(t.integer)
      })
      expect(count).toBe(2)
    })

    it("keeps the changes of a seed after a statement of it fails", async () => {
      const fixture = await openTestFixture(database, async () => {
        await database.script("INSERT INTO test_run VALUES (1)")
        await expect(database.script("SELECT 1 / 0")).rejects.toThrow("division by zero")
        return await database.query`SELECT count(*) FROM test_run`.get(t.integer)
      })
      try {
        expect(fixture.data).toBe(1)
      } finally {
        await fixture.close()
      }
    })

    it("rolls back an aborted test once its running statement completes, and the next test runs in the fixture", async () => {
      const controller = new AbortController()
      const { promise: sleeping, resolve: startSleep } = Promise.withResolvers<void>()

      let slept = false
      const aborted = testTransaction(
        async () => {
          await database.script("INSERT INTO test_run VALUES (1)")
          const sleep = database.script("SELECT pg_sleep(0.1)")
          startSleep()
          await sleep
          slept = true
          await new Promise<never>(() => {})
        },
        { signal: controller.signal },
      )
      await sleeping
      controller.abort()

      await expect(aborted).rejects.toBe(controller.signal.reason)
      expect(slept).toBe(true)
      const count = await testTransaction(
        async () => await database.query`SELECT count(*) FROM test_run`.get(t.integer),
      )
      expect(count).toBe(0)
    })

    it("rolls back an aborted test once statement_timeout ends its running statement, and the next test runs in the fixture", async () => {
      const controller = new AbortController()
      const { promise: sleeping, resolve: startSleep } = Promise.withResolvers<void>()

      let failure: unknown
      const aborted = testTransaction(
        async () => {
          await database.script(`
            SET LOCAL statement_timeout = 50;
            INSERT INTO test_run VALUES (1);
          `)
          const sleep = database.script("SELECT pg_sleep(10)")
          startSleep()
          failure = await sleep.catch((error: unknown) => error)
          await new Promise<never>(() => {})
        },
        { signal: controller.signal },
      )
      await sleeping
      controller.abort()

      // The rollback, sent behind the statement that fails, still runs.
      await expect(aborted).rejects.toBe(controller.signal.reason)
      expect(failure).toMatchObject({ code: "57014" })
      const count = await testTransaction(
        async () => await database.query`SELECT count(*) FROM test_run`.get(t.integer),
      )
      expect(count).toBe(0)
    })
  },
)

describePostgres(
  "test transactions without a fixture in PostgreSQL",
  ({ database, testTransaction }) => {
    it("rejects SET TRANSACTION of the tested code, whose statements run in savepoints of their own", async () => {
      await testTransaction(
        async () => {
          await expect(
            database.script("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE"),
          ).rejects.toMatchObject({ code: "25001" })
        },
        { isolation: "read committed" },
      )
    })
  },
)

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
      "SAVEPOINT kern_2",
      "seed",
      "RELEASE SAVEPOINT kern_2",
      "RELEASE SAVEPOINT kern_1",
      "SAVEPOINT kern_1",
      "SAVEPOINT kern_2",
      "test",
      "RELEASE SAVEPOINT kern_2",
      "ROLLBACK TO SAVEPOINT kern_1",
      "RELEASE SAVEPOINT kern_1",
      "ROLLBACK",
    ])
    expect(releases).toEqual([{ connection: 1 }])
  })

  // Orchid ORM ran the rest of such a seed in the enclosing test transaction: https://github.com/romeerez/orchid-orm/issues/798
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

describe("openTestFixture", () => {
  it("opens a fixture in which test transactions run until it closes", async () => {
    const { database, statements, releases, testTransaction } = createTestDatabase()

    const fixture = await openTestFixture(database, async () => {
      await database.execute(createStatement("seed"))
      return "seeded"
    })
    await testTransaction(() => database.execute(createStatement("test")))
    expect(fixture.data).toBe("seeded")
    await fixture.close()

    expect(() => fixture.data).toThrow("Test fixture is closed")
    expect(statements.map(({ text }) => text)).toEqual([
      "BEGIN",
      "SAVEPOINT kern_1",
      "SAVEPOINT kern_2",
      "seed",
      "RELEASE SAVEPOINT kern_2",
      "RELEASE SAVEPOINT kern_1",
      "SAVEPOINT kern_1",
      "SAVEPOINT kern_2",
      "test",
      "RELEASE SAVEPOINT kern_2",
      "ROLLBACK TO SAVEPOINT kern_1",
      "RELEASE SAVEPOINT kern_1",
      "ROLLBACK",
    ])
    expect(releases).toEqual([{ connection: 1 }])
  })

  it("rejects a database not created for tests", async () => {
    const { driver } = createRecordingDriver()

    await expect(
      openTestFixture(createDatabase({ driver }), () => Promise.resolve()),
    ).rejects.toThrow("openTestFixture requires a database created with test: true")
  })
})

describePostgres(
  "openTestTransaction in PostgreSQL",
  ({ database, testTransaction, useTestFixture }) => {
    useTestFixture(() => database.script("CREATE TABLE test_request (id integer PRIMARY KEY)"))

    const count = async () => await database.query`SELECT count(*) FROM test_request`.get(t.integer)

    it("shares the changes of concurrent callbacks, keeps them after a failed statement, and rolls them back on closing", async () => {
      const opened = await openTestTransaction(database)
      try {
        await opened.run(() => database.script("INSERT INTO test_request VALUES (1)"))
        await Promise.all([
          expect(
            opened.run(() => database.script("INSERT INTO test_request VALUES (1)")),
          ).rejects.toMatchObject({ code: "23505" }),
          opened.run(() =>
            database.transaction(async () => {
              await database.script("INSERT INTO test_request VALUES (2)")
              await database.script("INSERT INTO test_request VALUES (3)")
            }),
          ),
          opened.run(() => database.script("INSERT INTO test_request VALUES (4)")),
        ])
        expect(await opened.run(count)).toBe(4)
      } finally {
        await opened.close()
      }
      expect(await testTransaction(count)).toBe(0)
    })
  },
)

describe("wrapTest", () => {
  interface DeclaredTest {
    name: string
    fn: (...args: unknown[]) => unknown
    args: unknown[]
    options?: unknown
  }

  /** `test` of a runner that records the tests it declares, with a modifier that requires the runner as `this`, as modifiers of `bun:test` do. */
  function createRunner() {
    const declared: DeclaredTest[] = []
    const test = (name: string, fn: (...args: unknown[]) => unknown, options?: unknown) => {
      declared.push({ name, fn, args: [], options })
    }
    test.each = function <Row extends unknown[]>(this: unknown, table: Row[]) {
      if (this !== test) {
        throw new TypeError("Expected the test function as this")
      }
      return (name: string, fn: (...row: Row) => unknown) => {
        for (const row of table) {
          declared.push({ name, fn: fn as (...args: unknown[]) => unknown, args: row })
        }
      }
    }
    return { test, declared }
  }

  it("runs every test it declares in its own test transaction and keeps the options of the test", async () => {
    const { database, statements, wrapTest } = createTestDatabase()
    const { test, declared } = createRunner()

    wrapTest(test)("runs", () => database.execute(createStatement("test")), 50)
    expect(declared.map(({ name, options }) => ({ name, options }))).toEqual([
      { name: "runs", options: 50 },
    ])
    await declared[0]!.fn()
    await declared[0]!.fn()

    expect(statements.map(({ connection, text }) => `${connection}: ${text}`)).toEqual([
      "1: BEGIN",
      "1: SAVEPOINT kern_1",
      "1: test",
      "1: RELEASE SAVEPOINT kern_1",
      "1: ROLLBACK",
      "2: BEGIN",
      "2: SAVEPOINT kern_1",
      "2: test",
      "2: RELEASE SAVEPOINT kern_1",
      "2: ROLLBACK",
    ])
  })

  it("wraps the modifiers of the runner and the test functions they return", async () => {
    const { database, statements, wrapTest } = createTestDatabase()
    const { test, declared } = createRunner()

    wrapTest(test).each([["row 1"], ["row 2"]])("runs %s", text =>
      database.execute(createStatement(text)),
    )
    for (const { fn, args } of declared) {
      await fn(...args)
    }

    expect(statements.map(({ text }) => text)).toEqual([
      "BEGIN",
      "SAVEPOINT kern_1",
      "row 1",
      "RELEASE SAVEPOINT kern_1",
      "ROLLBACK",
      "BEGIN",
      "SAVEPOINT kern_1",
      "row 2",
      "RELEASE SAVEPOINT kern_1",
      "ROLLBACK",
    ])
  })

  it("rolls back the test transaction once the signal of the test context aborts, as of node:test", async () => {
    const { database, statements, wrapTest } = createTestDatabase()
    const { test, declared } = createRunner()
    const { promise: started, resolve: start } = Promise.withResolvers<void>()
    const controller = new AbortController()

    wrapTest(test)("times out", async () => {
      await database.execute(createStatement("test"))
      start()
      await new Promise<never>(() => {})
    })
    const running = declared[0]!.fn({ signal: controller.signal })
    await started
    controller.abort(new Error("The test timed out"))

    // The runner awaits the test until its signal aborts, so the test rejects with its reason.
    await expect(running).rejects.toEqual(new Error("The test timed out"))
    expect(statements.map(({ text }) => text)).toEqual([
      "BEGIN",
      "SAVEPOINT kern_1",
      "test",
      "RELEASE SAVEPOINT kern_1",
      "ROLLBACK",
    ])
  })

  it("ignores a signal in a row of test.each, which belongs to the data of the test", async () => {
    const { database, statements, wrapTest } = createTestDatabase()
    const { test, declared } = createRunner()

    wrapTest(test).each([[{ signal: AbortSignal.abort() }]])("runs %o", () =>
      database.execute(createStatement("test")),
    )
    await declared[0]!.fn(...declared[0]!.args)

    expect(statements.map(({ text }) => text)).toEqual([
      "BEGIN",
      "SAVEPOINT kern_1",
      "test",
      "RELEASE SAVEPOINT kern_1",
      "ROLLBACK",
    ])
  })

  it("rolls back the test transaction once onTestFinished reports that the runner has finished the test, ignoring a signal in the data of the test, and passes the failure of an unfinished test to the runner", async () => {
    const { driver, statements } = createRecordingDriver()
    const database = createDatabase({ driver, test: true })
    const finished: (() => void)[] = []
    const { wrapTest } = createTestHelpers(database, {
      ...createManualHooks().hooks,
      onTestFinished: hook => finished.push(hook),
    })
    const { test, declared } = createRunner()
    const { promise: started, resolve: start } = Promise.withResolvers<void>()

    wrapTest(test)("times out", async () => {
      await database.execute(createStatement("test"))
      start()
      await new Promise<never>(() => {})
    })
    wrapTest(test)("fails", () => Promise.reject(new Error("The test fails")))
    // With onTestFinished, the first argument is the data of the test, such as a row of test.each.
    const running = declared[0]!.fn({ signal: AbortSignal.abort() })
    await started
    await expect(declared[1]!.fn()).rejects.toEqual(new Error("The test fails"))
    for (const hook of finished) {
      hook()
    }

    // The runner has given up on the test, so its rejection would be reported as an error between tests.
    await running
    expect(statements.map(({ connection, text }) => `${connection}: ${text}`)).toEqual([
      "1: BEGIN",
      "1: SAVEPOINT kern_1",
      "1: test",
      "1: RELEASE SAVEPOINT kern_1",
      "2: BEGIN",
      "2: ROLLBACK",
      "1: ROLLBACK",
    ])
  })
})
