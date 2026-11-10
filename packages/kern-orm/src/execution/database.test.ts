import { expect, it } from "bun:test"

import { createRecordingDriver } from "../../testing/recording-driver"
import { identifier } from "../expression/sql"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { createDatabase } from "./database"

it("rejects a table of a Db and an expression in the templates of a script and a query, which take the fragments of the database layer", async () => {
  const { driver, scripts, statements } = createRecordingDriver()
  const database = createDatabase({ driver })
  const form = defineTable("form", {
    id: t.integer,
  })
  const db = database.bind(defineSchema({ form }))
  const message = "A parameter without a codec takes a string"

  // @ts-expect-error A table of a Db takes $script of the Db.
  await expect(database.script`ANALYZE ${db.form}`).rejects.toThrow(message)
  // @ts-expect-error An expression is not a fragment of the database layer.
  await expect(database.script`ANALYZE ${identifier("form")}`).rejects.toThrow(message)
  // @ts-expect-error A table of a Db takes $query of the Db.
  expect(() => database.query`SELECT FROM ${db.form}`).toThrow(message)
  // @ts-expect-error An expression is not a fragment of the database layer.
  expect(() => database.query`SELECT FROM ${identifier("form")}`).toThrow(message)
  expect(scripts).toEqual([])
  expect(statements).toEqual([])
})
