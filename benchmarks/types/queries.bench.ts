// Instantiations that one more query adds to a consumer that already runs a query of each kind on other columns: the cost of each further query of an application.
// The count in `.types([...])` is the one that `bun run --cwd benchmarks bench:types -u` wrote; a run prints the change from it.

import { bench } from "@ark/attest"
import type { DbOf } from "kern-orm"

import { formsDb, formsSchema, tenantDb } from "./fixture.ts"

// Code shared by several Dbs runs queries on a Db typed by the shared schema.
const sharedDb: DbOf<typeof formsSchema> = tenantDb

bench.baseline(async () => {
  await tenantDb.form.where({ name: "baseline" }).pluck("id")
  await formsDb.$execute(
    formsSchema.form
      .where({ name: "baseline" })
      .select("id", "published")
      .select(form => ({
        heading: form.name,
      }))
      .take(),
  )
  await sharedDb.$execute(
    formsSchema.form
      .where({ name: "baseline" })
      .select("id", "published")
      .select(form => ({
        heading: form.name,
      }))
      .take(),
  )
  await tenantDb.$execute(
    formsSchema.form
      .where({ name: "baseline" })
      .select("name")
      .select(form => ({
        fields: form.fields.select("id"),
      })),
  )
  await tenantDb.$execute(
    formsSchema.field
      .where({ label: "baseline" })
      .select("label")
      .select(field => ({
        form: field.form.select("id"),
      })),
  )
})

bench("bound query", async () => {
  await tenantDb.form.where({ published: true }).pluck("name")
}).types([360, "instantiations"])

bench("unbound query", async () => {
  await formsDb.$execute(
    formsSchema.form
      .where({ id: "x" })
      .select("id", "name")
      .select(form => ({
        title: form.name,
      }))
      .take(),
  )
}).types([1057, "instantiations"])

bench("unbound query on DbOf", async () => {
  await sharedDb.$execute(
    formsSchema.form
      .where({ id: "x" })
      .select("id", "name")
      .select(form => ({
        title: form.name,
      }))
      .take(),
  )
}).types([1057, "instantiations"])

bench("relation many", async () => {
  await tenantDb.$execute(
    formsSchema.form
      .where({ id: "x" })
      .select("id")
      .select(form => ({
        fields: form.fields.select("label", "position"),
      })),
  )
}).types([1571, "instantiations"])

bench("relation one", async () => {
  await tenantDb.$execute(
    formsSchema.field
      .where({ id: "x" })
      .select("id")
      .select(field => ({
        form: field.form.select("name", "published"),
      })),
  )
}).types([1579, "instantiations"])
