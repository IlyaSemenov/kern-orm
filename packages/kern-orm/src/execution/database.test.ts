import { describe, expect, it } from "bun:test"

import { describePostgres } from "../../testing/postgres"
import { createRecordingDriver } from "../../testing/recording-driver"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { createDatabase } from "./database"
import { createStatement } from "./driver"

it("closes the driver when disposed", async () => {
  const { driver } = createRecordingDriver()
  let closed = false
  driver.close = () => {
    closed = true
    return Promise.resolve()
  }

  {
    await using database = createDatabase({ driver })
    expect(database).toBeDefined()
  }

  expect(closed).toBe(true)
})

it("rejects queries, scripts, and transactions of a database created for tests outside a test transaction", async () => {
  const { driver, statements, scripts } = createRecordingDriver()
  const database = createDatabase({ driver, test: true })

  await expect(database.execute(createStatement("outside"))).rejects.toThrow(
    "Cannot execute a query outside a test transaction",
  )
  await expect(database.script("outside")).rejects.toThrow(
    "Cannot execute a script outside a test transaction",
  )
  await expect(database.transaction(() => Promise.resolve())).rejects.toThrow(
    "Cannot start a transaction outside a test transaction",
  )
  expect(statements).toEqual([])
  expect(scripts).toEqual([])
})

it("executes a script without a Db, rejecting tables of a Db", async () => {
  const { driver, scripts } = createRecordingDriver()
  const database = createDatabase({ driver })
  const form = defineTable("form", {
    id: t.integer,
  })
  const db = database.bind(defineSchema({ form }))

  await database.script("SET lock_timeout = '1s'; SELECT 1")
  await database.script`SET lock_timeout = '2s'; SELECT 2`
  await expect(database.script`ANALYZE ${db.form}`).rejects.toThrow(
    'Table "form" interpolated into SQL is bound to another Db',
  )

  expect(scripts).toEqual([
    { connection: "pool", script: "SET lock_timeout = '1s'; SELECT 1" },
    { connection: "pool", script: "SET lock_timeout = '2s'; SELECT 2" },
  ])
})

describe("advisory locks", () => {
  it("rejects a lock outside a transaction, also in a test transaction, without a statement", async () => {
    const { driver, statements } = createRecordingDriver()
    const database = createDatabase({ driver, test: true })
    const message =
      "Cannot take an advisory lock outside a transaction, where it would end with its statement; a test transaction alone does not count"

    await expect(database.lock("import")).rejects.toThrow(message)
    await database.coordinator.testTransaction(async () => {
      await expect(database.lock("import")).rejects.toThrow(message)
    })

    expect(statements.map(({ text }) => text)).toEqual(["BEGIN", "ROLLBACK"])
  })

  describePostgres("in PostgreSQL", ({ database, testTransaction }) => {
    const countLocks = async (key: string) =>
      await database.query`
        SELECT count(*)::integer FROM pg_locks
        WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted
          AND (classid::bigint << 32) + objid::bigint = hashtextextended(${key}, 0)
      `.get(t.integer)

    it("keeps the locks of the transaction and of a released nested transaction, and releases those of a nested transaction that rolls back", async () => {
      const failure = new Error("failure")

      const counts = await testTransaction(() =>
        database.transaction(async () => {
          await database.lock("import")
          const released = database.transaction(async () => {
            await database.lock("export")
            throw failure
          })
          await expect(released).rejects.toBe(failure)
          await database.transaction(() => database.lock("report"))
          return {
            import: await countLocks("import"),
            export: await countLocks("export"),
            report: await countLocks("report"),
          }
        }),
      )

      expect(counts).toEqual({ import: 1, export: 0, report: 1 })
    })
  })
})

describePostgres("search path in PostgreSQL", ({ database, testTransaction }) => {
  const getSearchPath = async () =>
    await database.query`SELECT current_setting('search_path')`.get(t.text)

  // Orchid ORM ignored the settings of a transaction inside a test transaction: https://github.com/romeerez/orchid-orm/pull/806
  it("sets the search path of nested transactions and restores the enclosing one when each is released", async () => {
    const paths = await testTransaction(async () => {
      const initial = await getSearchPath()
      const nested = await database.transaction(
        async () => ({
          outer: await getSearchPath(),
          inner: await database.transaction(getSearchPath, { searchPath: ["Tenant"] }),
          after: await getSearchPath(),
        }),
        { searchPath: ["tenant_1", "extensions"] },
      )
      return { initial, nested, after: await getSearchPath() }
    })

    expect(paths).toEqual({
      initial: paths.initial,
      nested: {
        outer: '"tenant_1", "extensions"',
        inner: '"Tenant"',
        after: '"tenant_1", "extensions"',
      },
      after: paths.initial,
    })
  })

  it("restores the search path of the enclosing transaction when a nested one rolls back", async () => {
    const failure = new Error("failure")

    const paths = await testTransaction(async () => {
      const initial = await getSearchPath()
      const nested = database.transaction(
        async () => {
          await getSearchPath()
          throw failure
        },
        { searchPath: ["tenant_1"] },
      )
      await expect(nested).rejects.toBe(failure)
      return { initial, after: await getSearchPath() }
    })

    expect(paths.after).toBe(paths.initial)
  })
})
