// Instantiations that one more query adds to a consumer that already runs a query of each kind on other columns: the cost of each further query of an application.
// The count in `.types([...])` is the one that `bun run --cwd benchmarks bench:types -u` wrote; a run prints the change from it.

import { bench } from "@ark/attest"
import type { DbOf } from "kern-orm"
import { defineHelper } from "kern-orm"

import { formsDb, formsSchema, tenantDb } from "./fixture.ts"

// Code shared by several Dbs runs queries on a Db typed by the shared schema.
const sharedDb: DbOf<typeof formsSchema> = tenantDb

const withLabel = defineHelper(formsSchema.field, field => field.select("label"))
const withPositions = defineHelper(formsSchema.form, form =>
  form.select(columns => ({
    positions: columns.fields.pluck("position"),
  })),
)
const withName = defineHelper(formsSchema.form, form => form.select("name"))
const withFieldIds = defineHelper(formsSchema.form, form =>
  form.select(columns => ({
    fieldIds: columns.fields.pluck("id"),
  })),
)

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
  await tenantDb.field.find("baseline").select("label")
  await tenantDb.field.findBy({ id: "baseline" }).select("label")
  await tenantDb.field.select("id").use(withLabel)
  await tenantDb.form.select("published").use(withPositions)
})

bench("bound query", async () => {
  await tenantDb.form.where({ published: true }).pluck("name")
}).types([544, "instantiations"])

bench("find", async () => {
  await tenantDb.form.find("x").select("name")
}).types([280, "instantiations"])

bench("findBy", async () => {
  await tenantDb.form.findBy({ id: "x" }).select("name")
}).types([307, "instantiations"])

bench("helper", async () => {
  await tenantDb.form.select("id").use(withName)
}).types([993, "instantiations"])

bench("helper of relations", async () => {
  await tenantDb.form.select("id").use(withFieldIds)
}).types([1079, "instantiations"])

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
}).types([902, "instantiations"])

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
}).types([902, "instantiations"])

bench("relation many", async () => {
  await tenantDb.$execute(
    formsSchema.form
      .where({ id: "x" })
      .select("id")
      .select(form => ({
        fields: form.fields.select("label", "position"),
      })),
  )
}).types([962, "instantiations"])

bench("relation one", async () => {
  await tenantDb.$execute(
    formsSchema.field
      .where({ id: "x" })
      .select("id")
      .select(field => ({
        form: field.form.select("name", "published"),
      })),
  )
}).types([768, "instantiations"])
