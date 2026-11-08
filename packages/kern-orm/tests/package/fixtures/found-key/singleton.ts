// The query of a singleton table, the key of no columns, which stays distinct from a query of `find` for `upsert` with `strictNullChecks` alone, and the queries of tables of generic types.
import type { InsertValues, UpsertValues } from "kern-orm"
import { defineSchema, defineTable, from } from "kern-orm"
import * as t from "kern-orm/types"

const license = defineTable(
  "license",
  {
    id: t.uuid.primaryKey(),
    token: t.text,
  },
  { singleton: true },
)
const page = defineTable("page", {
  id: t.uuid.primaryKey(),
  title: t.text,
})
const schema = defineSchema({ license })

function upsertRow(query: typeof schema.license) {
  return query.upsert({ id: "license-id", token: "token" })
}
upsertRow(schema.license)
// @ts-expect-error A query of the key of find.
upsertRow(schema.license.find("license-id"))

const byId = schema.license.find("license-id")

function upsertById(query: typeof byId) {
  return query.upsert({ token: "token" })
}
upsertById(byId)
// @ts-expect-error The query of the table gives no key.
upsertById(schema.license)

// A table of a generic type starts the query that the constraint of its type tells.
export function requireToken<T extends typeof license>(table: T, values: UpsertValues<T, never>) {
  void from(table).upsert(values)
  return from(table).required().get("token")
}
export function pageOfRows<T extends typeof page>(table: T, values: InsertValues<T>) {
  void from(table).insert(values)
  return from(table).limit(10).pluck("title")
}

// @ts-expect-error A singleton table holds one row.
schema.license.insertMany([{ id: "license-id", token: "token" }])
// @ts-expect-error A query of one row.
schema.license.all()
