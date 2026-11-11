import { describe, test } from "bun:test"

import type { Database, Driver } from "kern-db"
import type { DbOf } from "kern-orm"
import { defineSchema, defineTable, many } from "kern-orm"
import * as t from "kern-orm/types"

import type { MigrationTarget, MigrationTargetDb } from "./target"

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
declare const driver: Driver
declare const db: DbOf<typeof schema>

describe("MigrationTarget", () => {
  test("accepts a Db of kern-orm of any schema, and a Database and a Driver of kern-db", () => {
    db satisfies MigrationTargetDb
    db satisfies MigrationTarget
    database satisfies MigrationTarget
    driver satisfies MigrationTarget
  })

  test("rejects a schema that is not bound to a database", () => {
    // @ts-expect-error -- a schema is not bound to a database
    schema satisfies MigrationTarget
  })
})
