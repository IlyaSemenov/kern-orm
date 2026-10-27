import { afterAll, beforeAll, describe, expect, it } from "bun:test"

import type { PostgresJsDriverOptions } from "@kern-orm/postgres-js"
import { postgresJsDriver } from "@kern-orm/postgres-js"
import type { Database, Driver } from "kern-orm"
import {
  and,
  createDatabase,
  createStatement,
  defineSchema,
  defineTable,
  param,
  sql,
} from "kern-orm"
import { createTestHelpers } from "kern-orm/testing"
import * as t from "kern-orm/types"
import postgres from "postgres"

const { DATABASE_URL } = process.env

/** Helpers that run raw statements on `database`. */
function createStatementRunners(database: Database) {
  return {
    async runStatement(text: string) {
      await database.execute(createStatement(text))
    },
    async selectValue(text: string, parameters: string[] = []) {
      const { rows } = await database.execute(createStatement(text, parameters))
      return rows[0]![0]
    },
  }
}

describe.skipIf(!DATABASE_URL)("postgresJsDriver", () => {
  const database = createDatabase({ driver: postgresJsDriver(postgres(DATABASE_URL!)) })
  afterAll(() => database.close())
  const { runStatement, selectValue } = createStatementRunners(database)

  it("executes a query in a transaction", async () => {
    const tag = defineTable("pg_tag_test", {
      id: t.integer,
      label: t.text,
    })
    const db = database.bind(defineSchema({ tag }))

    const rows = await database.transaction(async () => {
      await runStatement("CREATE TEMP TABLE pg_tag_test (id integer, label text) ON COMMIT DROP")
      await runStatement("INSERT INTO pg_tag_test VALUES (1, 'first'), (2, 'second')")
      return await db.tag.select("label").where({ id: 2 })
    })

    expect(rows).toEqual([{ label: "second" }])
  })

  it("decodes selected expressions with their types", async () => {
    const tag = defineTable("pg_tag_test", {
      id: t.integer,
      label: t.text.nullable(),
    })
    const db = database.bind(defineSchema({ tag }))

    const rows = await database.transaction(async () => {
      await runStatement("CREATE TEMP TABLE pg_tag_test (id integer, label text) ON COMMIT DROP")
      await runStatement("INSERT INTO pg_tag_test VALUES (1, 'first'), (2, NULL)")
      return await db.tag.select(columns => ({
        key: columns.id,
        name: columns.label,
        isFirst: columns.label.eq("first"),
        total: sql(t.bigint)`count(*) OVER ()`,
        length: sql(t.integer.nullable())`length(${columns.label})`,
      }))
    })

    // The query has no order, so the rows are sorted here.
    expect(rows.toSorted((a, b) => a.key - b.key)).toEqual([
      { key: 1, name: "first", isFirst: true, total: 2n, length: 5 },
      { key: 2, name: null, isFirst: null, total: 2n, length: null },
    ])
  })

  it("rejects a transaction whose failed statement the callback caught", async () => {
    const transaction = database.transaction(async () => {
      await runStatement("SELECT 1/0").catch(() => {})
      return "done"
    })

    await expect(transaction).rejects.toThrow("Transaction was rolled back")
  })

  it("releases a clean connection after a failed commit", async () => {
    // One pooled connection makes the next statement run on the connection of the failed transaction.
    const single = createDatabase({ driver: postgresJsDriver(postgres(DATABASE_URL!, { max: 1 })) })
    try {
      const transaction = single.transaction(async () => {
        await single.execute(
          createStatement(
            "CREATE TEMP TABLE pg_commit_test (id integer UNIQUE DEFERRABLE INITIALLY DEFERRED) ON COMMIT DROP",
          ),
        )
        await single.execute(createStatement("INSERT INTO pg_commit_test VALUES (1), (1)"))
      })
      await expect(transaction).rejects.toThrow("duplicate key")

      await expect(single.execute(createStatement("SAVEPOINT probe"))).rejects.toThrow(
        "transaction blocks",
      )
    } finally {
      await single.close()
    }
  })

  it("rolls back a failed transaction before releasing its connection after a failure", async () => {
    // One pooled connection makes the next statement run on the released connection.
    const driver = postgresJsDriver(postgres(DATABASE_URL!, { max: 1 }))
    try {
      const connection = await driver.acquire()
      await connection.execute(createStatement("BEGIN"))
      const error = await connection
        .execute(createStatement("SELECT 1/0"))
        .catch((error: unknown) => error)
      await connection.release({ error })

      await expect(driver.execute(createStatement("SAVEPOINT probe"))).rejects.toThrow(
        "transaction blocks",
      )
    } finally {
      await driver.close()
    }
  })

  // Transaction-local settings and backend PIDs observe routing without committed tables.
  it("isolates concurrent transactions on their own connections", async () => {
    const bothStarted = Promise.withResolvers<void>()
    let startedCount = 0

    function runTransaction(label: string) {
      return database.transaction(async () => {
        const startPid = await selectValue("SELECT pg_backend_pid()")
        await selectValue("SELECT set_config('kern.test', $1, true)", [label])
        startedCount += 1
        if (startedCount === 2) {
          bothStarted.resolve()
        }
        await bothStarted.promise
        return {
          startPid,
          endPid: await selectValue("SELECT pg_backend_pid()"),
          label: await selectValue("SELECT current_setting('kern.test')"),
        }
      })
    }

    const [result1, result2] = await Promise.all([runTransaction("1"), runTransaction("2")])

    expect(result1.endPid).toBe(result1.startPid)
    expect(result2.endPid).toBe(result2.startPid)
    expect(result1.startPid).not.toBe(result2.startPid)
    expect([result1.label, result2.label]).toEqual(["1", "2"])
  })

  it("runs queries outside an open transaction on the pool", async () => {
    const transactionStarted = Promise.withResolvers<void>()
    const outsideFinished = Promise.withResolvers<void>()

    const transactionPid = database.transaction(async () => {
      await selectValue("SELECT set_config('kern.test', 'inside', true)")
      transactionStarted.resolve()
      await outsideFinished.promise
      return selectValue("SELECT pg_backend_pid()")
    })
    await transactionStarted.promise
    const outsidePid = await selectValue("SELECT pg_backend_pid()")
    const outsideLabel = await selectValue("SELECT current_setting('kern.test', true)")
    outsideFinished.resolve()

    expect(outsidePid).not.toBe(await transactionPid)
    expect(outsideLabel).not.toBe("inside")
  })

  describe("closing", () => {
    /** Creates a database whose client has one connection by default, so that a transaction waits for the connection of another one. */
    function createClosableDatabase(
      options: { max?: number; onclose?: () => void } & PostgresJsDriverOptions = {},
    ) {
      const { max = 1, onclose, closeTimeout } = options
      const driver = postgresJsDriver(postgres(DATABASE_URL!, { max, onclose }), { closeTimeout })
      return { driver, database: createDatabase({ driver }) }
    }

    /** Keeps an alive connection of `driver` reserved, as after a transaction that may have lost it. */
    async function keepConnection(driver: Driver) {
      const connection = await driver.acquire()
      await connection.release({ error: new Error("connection") })
    }

    it("waits for a running transaction and for a transaction waiting for a connection", async () => {
      const { database } = createClosableDatabase()
      const { promise: started, resolve: start } = Promise.withResolvers<void>()
      const { promise: closeRequested, resolve: requestClose } = Promise.withResolvers<void>()
      const { selectValue } = createStatementRunners(database)

      const running = database.transaction(async () => {
        start()
        await closeRequested
        return selectValue("SELECT 'running'")
      })
      await started
      const waiting = database.transaction(() => selectValue("SELECT 'waiting'"))
      const closing = database.close()
      requestClose()

      expect(await running).toBe("running")
      expect(await waiting).toBe("waiting")
      await closing
    })

    it("waits for a transaction that gets a lost connection kept reserved once the pool reconnects it", async () => {
      const { promise: lost, resolve: loseConnection } = Promise.withResolvers<void>()
      // Waiting for the close timeout would outlast the test, so giving up on the transaction or on the lost connection fails it.
      const { driver, database } = createClosableDatabase({
        onclose: loseConnection,
        closeTimeout: 60,
      })
      const { selectValue: selectValueOnClosable } = createStatementRunners(database)

      const connection = await driver.acquire()
      const { rows } = await connection.execute(createStatement("SELECT pg_backend_pid()"))
      await selectValue("SELECT pg_terminate_backend($1)", [rows[0]![0]!])
      await lost
      await connection.release({ error: new Error("connection") })
      const waiting = database.transaction(() => selectValueOnClosable("SELECT 'waiting'"))
      await database.close()

      expect(await waiting).toBe("waiting")
    })

    it("terminates an alive connection kept reserved after the close timeout", async () => {
      const { driver, database } = createClosableDatabase({ closeTimeout: 0.1 })

      await keepConnection(driver)
      await database.close()
    })

    it("rejects a transaction waiting behind an alive connection kept reserved", async () => {
      const { driver, database } = createClosableDatabase({ closeTimeout: 0.1 })
      let called = false

      await keepConnection(driver)
      const waiting = database.transaction(async () => {
        called = true
      })
      waiting.catch(() => {})
      await database.close()

      await expect(waiting).rejects.toThrow("CONNECTION_DESTROYED")
      expect(called).toBe(false)
    })

    it("lets a query on the pool complete while a connection kept reserved delays closing", async () => {
      const { driver, database } = createClosableDatabase({ max: 2, closeTimeout: 1 })
      const { selectValue: selectValueOnClosable } = createStatementRunners(database)

      await keepConnection(driver)
      const query = selectValueOnClosable("SELECT 'slept' FROM pg_sleep(0.2)")
      await database.close()

      expect(await query).toBe("slept")
    })
  })

  // Tests that create tables and data run in test transactions, which leave the database unchanged.
  describe("in test transactions", () => {
    const database = createDatabase({
      driver: postgresJsDriver(postgres(DATABASE_URL!)),
      test: true,
    })
    afterAll(() => database.close())
    const { testTransaction } = createTestHelpers(database, {
      before: beforeAll,
      after: afterAll,
    })
    const { runStatement, selectValue } = createStatementRunners(database)

    it("discards only the rows of a rolled-back nested transaction", async () => {
      const tag = defineTable("pg_nested_test", {
        id: t.integer,
      })
      const db = database.bind(defineSchema({ tag }))

      const rows = await testTransaction(async () => {
        await runStatement("CREATE TABLE pg_nested_test (id integer)")
        await runStatement("INSERT INTO pg_nested_test VALUES (1)")
        const failure = new Error("failure")
        const failed = database.transaction(async () => {
          await runStatement("INSERT INTO pg_nested_test VALUES (2)")
          throw failure
        })
        await expect(failed).rejects.toBe(failure)
        await database.transaction(() => runStatement("INSERT INTO pg_nested_test VALUES (3)"))
        return await db.tag.select("id")
      })

      expect(rows.map(({ id }) => id).toSorted()).toEqual([1, 3])
    })

    it("keeps the transaction usable after a failed statement in a nested transaction", async () => {
      const value = await testTransaction(async () => {
        await expect(database.transaction(() => runStatement("SELECT 1/0"))).rejects.toThrow(
          "division by zero",
        )
        return await selectValue("SELECT 'usable'")
      })

      expect(value).toBe("usable")
    })

    it("keeps the changes of open fixtures for test transactions until each fixture closes", async () => {
      const entry = defineTable("pg_fixture_test", {
        label: t.text,
      })
      const db = database.bind(defineSchema({ entry }))
      const selectLabels = () =>
        testTransaction(async () => {
          const rows = await db.entry.select("label")
          return rows.map(({ label }) => label).toSorted()
        })

      {
        await using _run = await database.coordinator.createTestFixture(async () => {
          await runStatement("CREATE TABLE pg_fixture_test (label text)")
          await runStatement("INSERT INTO pg_fixture_test VALUES ('run')")
        })
        {
          await using file = await database.coordinator.createTestFixture(async () => {
            await runStatement("INSERT INTO pg_fixture_test VALUES ('file')")
            return await db.entry.where({ label: "file" }).select("label")
          })
          expect(file.data).toEqual([{ label: "file" }])

          const inTest = await testTransaction(async () => {
            await runStatement("INSERT INTO pg_fixture_test VALUES ('test')")
            return (await db.entry.select("label")).map(({ label }) => label).toSorted()
          })
          expect(inTest).toEqual(["file", "run", "test"])
          expect(await selectLabels()).toEqual(["file", "run"])
        }
        expect(await selectLabels()).toEqual(["run"])
      }

      expect(
        await testTransaction(() => selectValue("SELECT to_regclass('pg_fixture_test')")),
      ).toBeNull()
    })

    // postgres.js waits for reserved connections when it ends, so ending it under an open fixture would wait forever.
    it("closes a database with an open fixture", async () => {
      const closed = createDatabase({
        driver: postgresJsDriver(postgres(DATABASE_URL!, { max: 1 })),
        test: true,
      })
      const fixture = await closed.coordinator.createTestFixture(() =>
        closed.execute(createStatement("SELECT 1")),
      )

      await closed.close()

      expect(() => fixture.data).toThrow("Test fixture is closed")
    })

    it("round-trips the built-in types", async () => {
      const sample = defineTable("pg_type_test", {
        bigint: t.bigint,
        numeric: t.numeric.with(20, 6),
        price: t.numeric.with(10, 2).transform({ decode: Number }),
        double: t.doublePrecision,
        flag: t.boolean,
        id: t.uuid,
        bytes: t.bytea,
        at: t.timestamptz,
        local: t.timestamp,
        day: t.date,
        clock: t.time,
        span: t.interval,
        doc: t.jsonb.of<{ tags: string[] }>(),
        labels: t.array(t.text.nullable()),
        address: t.inet,
        status: t.enum("pg_status_test", ["draft", "published"]),
      })
      const db = database.bind(defineSchema({ sample }))
      const values = {
        bigint: 9007199254740993n,
        numeric: "12345678901234.123456",
        price: 12.5,
        double: 0.1,
        flag: true,
        id: "0193d6b6-7c43-7000-8000-000000000001",
        bytes: new Uint8Array([0, 255]),
        at: "2026-01-15T07:00:00.123456Z",
        local: "2026-01-15T10:00:00.000000",
        day: "2026-01-15",
        clock: "10:00:00.500000",
        span: "1 day 02:00:00",
        doc: { tags: ["a", "b"] },
        labels: ["a", "b c", null, "NULL"],
        address: "192.168.0.1",
        status: "published" as const,
      }

      const rows = await testTransaction(async () => {
        // A time zone far from UTC checks that timestamptz values are normalized.
        await runStatement("SET LOCAL TIME ZONE 'Asia/Bangkok'")
        await runStatement("CREATE TYPE pg_status_test AS ENUM ('draft', 'published')")
        await runStatement(`
          CREATE TABLE pg_type_test (
            bigint bigint, numeric numeric(20, 6), price numeric(10, 2), double double precision, flag boolean, id uuid,
            bytes bytea, at timestamptz, local timestamp, day date, clock time, span interval,
            doc jsonb, labels text[], address inet, status pg_status_test
          )
        `)
        await runStatement(`
          INSERT INTO pg_type_test VALUES (
            9007199254740993, 12345678901234.123456, 12.50, 0.1, true, '0193d6b6-7c43-7000-8000-000000000001',
            '\\x00ff', '2026-01-15 14:00:00.123456+07', '2026-01-15 10:00', '2026-01-15', '10:00:00.5',
            '1 day 2 hours', '{"tags": ["a", "b"]}', '{a,"b c",NULL,"NULL"}', '192.168.0.1', 'published'
          )
        `)
        const selected = await db.sample.select("*")
        // Every value also matches itself as an encoded parameter.
        const matched = await db.sample.where(values).select("id")
        return { selected, matched }
      })

      expect(rows.selected).toEqual([values])
      expect(rows.matched).toEqual([{ id: values.id }])
    })

    it("compares parameters of param with the operators of their types", async () => {
      const probe = defineTable("pg_param_test", {
        id: t.integer,
      })
      const db = database.bind(defineSchema({ probe }))

      const rows = await testTransaction(async () => {
        await runStatement("CREATE TABLE pg_param_test (id integer)")
        await runStatement("INSERT INTO pg_param_test VALUES (1)")
        return await db.probe
          .where(() =>
            and(
              // Compared as text, "2" is greater than "10".
              param(t.integer, 2).lt(10),
              // Cast to numeric(3,1), 1.04 would round to 1.0.
              param(t.numeric.with(3, 1), "1.04").ne("1.0"),
              // Cast to char, "ab" would truncate to "a".
              param(t.char, "ab").eq("ab"),
            ),
          )
          .select("id")
      })

      expect(rows).toEqual([{ id: 1 }])
    })

    it("round-trips date and time values of years outside 1 to 9999", async () => {
      const moment = defineTable("pg_moment_test", {
        id: t.integer,
        at: t.timestamptz,
        local: t.timestamp,
        day: t.date,
      })
      const db = database.bind(defineSchema({ moment }))
      const values = [
        {
          id: 1,
          at: "0000-01-01T00:00:00.000000Z",
          local: "-000001-06-15T10:00:00.000000",
          day: "-004712-01-01",
        },
        {
          id: 2,
          at: "+294276-12-31T23:59:59.999999Z",
          local: "+010000-01-01T00:00:00.000000",
          day: "+010000-01-01",
        },
        {
          id: 3,
          at: "9999-12-31T23:59:59.000000Z",
          local: "9999-12-31T23:59:59.000000",
          day: "+5874897-12-31",
        },
      ]

      const rows = await testTransaction(async () => {
        await runStatement("SET LOCAL TIME ZONE 'Asia/Bangkok'")
        await runStatement(
          "CREATE TABLE pg_moment_test (id integer, at timestamptz, local timestamp, day date)",
        )
        await runStatement(`
          INSERT INTO pg_moment_test VALUES
            (1, '0001-01-01 00:00:00+00 BC', '0002-06-15 10:00 BC', '4713-01-01 BC'),
            (2, '294276-12-31 23:59:59.999999+00', '10000-01-01', '10000-01-01'),
            (3, '9999-12-31 23:59:59+00', '9999-12-31 23:59:59', '5874897-12-31')
        `)
        const selected = await db.moment.select("*")
        // Every value also matches itself as an encoded parameter.
        const matched = await Promise.all(values.map(value => db.moment.where(value).select("id")))
        return { selected, matched }
      })

      expect(rows.selected).toEqual(values)
      expect(rows.matched).toEqual([[{ id: 1 }], [{ id: 2 }], [{ id: 3 }]])
    })
  })
})
