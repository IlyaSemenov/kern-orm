import { expect, it } from "bun:test"

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
