// Instantiations that one more query adds to a consumer that already runs a query of each kind on other columns: the cost of each further query of an application.
// The count in `.types([...])` is the one that `bun run --cwd benchmarks bench:types -u` wrote; a run prints the change from it.

import { bench } from "@ark/attest"
import type { DbOf } from "kern-orm"
import { defineHelper } from "kern-orm"

import { formsDb, formsSchema, storeDb, tenantDb } from "./fixture.ts"

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
  await tenantDb.$execute(
    formsSchema.field
      .where({ label: "baseline" })
      .select("label")
      .select(field => ({
        form: field.form.where({ name: "baseline" }).select("id"),
      })),
  )
  await tenantDb.field.find("baseline").select("label")
  await tenantDb.field.findBy({ id: "baseline" }).select("label")
  await tenantDb.field.where({ label: "baseline" }).count()
  await tenantDb.field.where({ label: "baseline" }).max("position")
  await tenantDb.field.where({ label: "baseline" }).min("label").coalesce("baseline")
  await tenantDb.field.select("id").use(withLabel)
  await tenantDb.form.select("published").use(withPositions)
  await tenantDb.$select({
    ids: tenantDb.form.pluck("id"),
    positions: tenantDb.field.pluck("position"),
  })
  await tenantDb.field
    .insert({ id: "baseline", formId: "baseline", position: 1, label: "baseline" })
    .get("id")
  await tenantDb.field.find("baseline").update({ label: "baseline" }).select("label", "position")
  await tenantDb.$execute(formsSchema.field.where({ label: "baseline" }).delete().pluck("label"))
  await storeDb.customer
    .where({ email: "baseline" })
    .select("email")
    .select(customer => ({
      addresses: customer.addresses.select("street"),
      orders: customer.orders.select("id").select(order => ({
        address: order.address.select("city"),
        lines: order.lines.select("id").select(line => ({
          variant: line.variant.select("weight").select(variant => ({
            prices: variant.prices.select("amount"),
            stocks: variant.stocks.select("id").select(stock => ({
              warehouse: stock.warehouse.select("name"),
            })),
            product: variant.product.select("description").select(product => ({
              brand: product.brand.select("id"),
              category: product.category.select("id").select(category => ({
                parent: category.parent.select("id"),
              })),
            })),
          })),
        })),
      })),
    }))
})

bench("bound query", async () => {
  await tenantDb.form.where({ published: true }).pluck("name")
}).types([528, "instantiations"])

bench("find", async () => {
  await tenantDb.form.find("x").select("name")
}).types([287, "instantiations"])

bench("findBy", async () => {
  await tenantDb.form.findBy({ id: "x" }).select("name")
}).types([314, "instantiations"])

bench("count", async () => {
  await tenantDb.form.where({ name: "x" }).count()
}).types([141, "instantiations"])

bench("aggregate of a column", async () => {
  await tenantDb.form.where({ name: "x" }).max("name")
}).types([155, "instantiations"])

bench("aggregate with a fallback", async () => {
  await tenantDb.form.where({ name: "x" }).max("name").coalesce("x")
}).types([261, "instantiations"])

bench("helper", async () => {
  await tenantDb.form.select("id").use(withName)
}).types([1045, "instantiations"])

bench("helper of relations", async () => {
  await tenantDb.form.select("id").use(withFieldIds)
}).types([1131, "instantiations"])

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
}).types([959, "instantiations"])

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
}).types([959, "instantiations"])

bench("relation many", async () => {
  await tenantDb.$execute(
    formsSchema.form
      .where({ id: "x" })
      .select("id")
      .select(form => ({
        fields: form.fields.select("label", "position"),
      })),
  )
}).types([1027, "instantiations"])

bench("relation one", async () => {
  await tenantDb.$execute(
    formsSchema.field
      .where({ id: "x" })
      .select("id")
      .select(field => ({
        form: field.form.select("name", "published"),
      })),
  )
}).types([834, "instantiations"])

bench("filtered relation one", async () => {
  await tenantDb.$execute(
    formsSchema.field
      .where({ id: "x" })
      .select("id")
      .select(field => ({
        form: field.form.where({ published: true }).select("name", "published"),
      })),
  )
}).types([1422, "instantiations"])

bench("root query of a deep relation graph", async () => {
  await storeDb.customer.where({ name: "x" }).select("name")
}).types([308, "instantiations"])

// Nests 6 levels of relations, from orders down to the parent category, with sibling relations on the way.
bench("query of a deep relation graph", async () => {
  await storeDb.customer
    .where({ name: "x" })
    .select("name")
    .select(customer => ({
      addresses: customer.addresses.select("city"),
      orders: customer.orders.select("placed").select(order => ({
        address: order.address.select("street"),
        lines: order.lines.select("quantity").select(line => ({
          variant: line.variant.select("sku").select(variant => ({
            prices: variant.prices.select("currency", "amount"),
            stocks: variant.stocks.select("quantity").select(stock => ({
              warehouse: stock.warehouse.select("city"),
            })),
            product: variant.product.select("name").select(product => ({
              brand: product.brand.select("name"),
              category: product.category.select("name").select(category => ({
                parent: category.parent.select("name"),
              })),
            })),
          })),
        })),
      })),
    }))
}).types([3720, "instantiations"])

bench("$select", async () => {
  await tenantDb.$select({
    names: tenantDb.form.pluck("name"),
    labels: tenantDb.field.pluck("label"),
  })
}).types([593, "instantiations"])

bench("insert", async () => {
  await tenantDb.form.insert({ id: "x", name: "x", published: true }).get("id")
}).types([507, "instantiations"])

bench("update", async () => {
  await tenantDb.form.find("x").update({ name: "x" }).select("id", "name")
}).types([515, "instantiations"])

bench("unbound delete", async () => {
  await tenantDb.$execute(formsSchema.form.where({ name: "x" }).delete().pluck("id"))
}).types([248, "instantiations"])
