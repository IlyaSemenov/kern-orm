import { describe, expectTypeOf, test } from "bun:test"

import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"
import { createDatabase } from "kern-db"

import { bindSchema } from "../execution/db"
import { sql } from "../expression/sql"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

const form = defineTable("form", {
  id: t.integer.primaryKey(),
  name: t.text,
})

const db = bindSchema(
  defineSchema({ form }),
  createDatabase({ driver: createRecordingDriver().driver }),
)

describe("comment", () => {
  test("keeps the type of each query", () => {
    const records = db.form.select("id").forUpdate().take()
    expectTypeOf(records.comment("forms")).toEqualTypeOf(records)

    const transformed = db.form.select("id").transform(rows => rows.length)
    expectTypeOf(transformed.comment("forms")).toEqualTypeOf(transformed)

    const record = db.$select({
      number: sql(t.integer)`1`,
    })
    expectTypeOf(record.comment("number")).toEqualTypeOf(record)

    const inserted = db.form.insert({ id: 1, name: "a" }).get("id")
    expectTypeOf(inserted.comment("forms")).toEqualTypeOf(inserted)
  })

  test("keeps the key of find, so that upsert applies after it", () => {
    const found = db.form.find(1)
    expectTypeOf(found.comment("forms")).toEqualTypeOf(found)
    found.comment("forms").upsert({ name: "a" })
  })

  test("takes a string or null, and rejects undefined and a number", () => {
    db.form.comment(null)
    // @ts-expect-error -- undefined could remove the comment by mistake
    db.form.comment(undefined)
    // @ts-expect-error -- a label is a string
    db.form.comment(1)
  })

  test("is not a method of a query of SQL text, whose text holds its comment", () => {
    // @ts-expect-error -- the text of the statement holds its comment
    db.$query`SELECT 1`.comment("one")
  })
})
