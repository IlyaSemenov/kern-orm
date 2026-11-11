// Uses the entry points of `kern-orm`, other than `kern-orm/db/node-postgres`, without connecting to a database, as an application that does not require `kern-db` itself.
import type { ResultOf } from "kern-orm"
import {
  bindSchema,
  createDatabase,
  defineSchema,
  defineTable,
  defineType,
  equalityOperators,
  FALSE,
  or,
  orderingOperators,
} from "kern-orm"
import { defineType as defineDbType, identifier, param } from "kern-orm/db"
import { postgresJsDriver } from "kern-orm/db/postgres-js"
import * as dbTypes from "kern-orm/db/types"
import type { TestFixture } from "kern-orm/testing"
import { createTestHelpers } from "kern-orm/testing"
import * as t from "kern-orm/types"
import postgres from "postgres"

const form = defineTable("form", {
  id: defineType(dbTypes.uuid).withOperators(orderingOperators),
  name: t.text,
  path: defineType(defineDbType({ sqlType: "ltree" })).withOperators(equalityOperators),
})

const driver = postgresJsDriver(postgres())
const database = createDatabase({ driver })
const db = bindSchema(defineSchema({ form }), database, { schemaName: "app" })

const query = db.form.where({ name: "Survey" }).select("id")
const record: ResultOf<typeof query> = { id: "form-id" }
const page = db.$select({
  names: db.form.pluck("name"),
})

// The fragments of `kern-orm/db`, which a template of `kern-orm` interpolates.
const formId = param(dbTypes.uuid, "form-id")
const statement = db.$query`DELETE FROM ${identifier("app", "form")} WHERE id = ${formId}`

// The hooks never run, so the fixture never opens.
const { useTestFixture } = createTestHelpers(createDatabase({ driver, test: true }), {
  before: () => {},
  after: () => {},
})
useTestFixture(async () => ({ formId: "form-id" })) satisfies TestFixture<{ formId: string }>

const { text, parameters } = query.toSQL()
console.log(
  JSON.stringify({
    text,
    parameters,
    record,
    pageText: page.toSQL().text,
    // A constant, created when the package loads.
    conditionText: db.form
      .where(or({ name: "Survey" }, FALSE))
      .select("id")
      .toSQL().text,
    statementText: statement.toSQL().text,
  }),
)
await database.close()
