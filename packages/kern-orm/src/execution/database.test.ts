import { expect, it } from "bun:test"

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
