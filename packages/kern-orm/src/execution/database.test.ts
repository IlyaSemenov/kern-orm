import { expect, it } from "bun:test"

import { createRecordingDriver } from "../../testing/recording-driver"
import { identifier } from "../expression/sql"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { createDatabase } from "./database"

it("rejects a table of a Db and an expression in the template of a script, which takes the fragments of the database layer", async () => {
  const { driver, scripts } = createRecordingDriver()
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
  expect(scripts).toEqual([])
})
