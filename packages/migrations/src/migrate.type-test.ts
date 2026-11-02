import { describe, test } from "bun:test"

import type { Database, DbOf } from "kern-orm"
import { defineSchema, defineTable, many } from "kern-orm"
import * as t from "kern-orm/types"

import { defineMigrations } from "./history"
import { migrate, rollback } from "./migrate"

const form = defineTable("form", {
  id: t.uuid.primaryKey(),
})
const field = defineTable("form_field", {
  id: t.uuid.primaryKey(),
  formId: t.uuid.columnName("form_id"),
})
const schema = defineSchema({ form, field }).$relations({
  form: {
    fields: many(field, { from: "id", to: "formId" }),
  },
})

declare const database: Database
declare const db: DbOf<typeof schema>
const history = defineMigrations({})

describe("targets", () => {
  test("accept a Db of any schema and a Database", async () => {
    await migrate(db, history)
    await migrate(database, history, { schemaName: "tenant_1" })
  })

  test("reject other values and a count that is neither a number nor all", async () => {
    // @ts-expect-error -- a schema is not bound to a database
    await migrate(schema, history)
    // @ts-expect-error -- a count is a number or "all"
    await rollback(db, history, { count: "last" })
  })
})
