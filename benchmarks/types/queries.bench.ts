// Instantiations that one more query adds to a consumer that already runs a query of each kind on other columns: the cost of each further query of an application.
// The count in `.types([...])` is the one that `bun run --cwd benchmarks bench:types -u` wrote; a run prints the change from it.

import { bench } from "@ark/attest"
import type { DbOf } from "kern-orm"
import { caseWhen, coalesce, defineHelper, desc, greatest, matches, not } from "kern-orm"
import * as t from "kern-orm/types"

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
  await tenantDb.field.where(field => field.label.eq("baseline")).pluck("id")
  // Another table, since reading the references instantiates the columns of the table, which the other benchmarks count.
  await storeDb.brand.where(brand => matches(brand, { name: "baseline" })).pluck("id")
  await tenantDb.field.pluck(field => field.label.lower())
  await tenantDb.field.find("baseline").get(field => field.label.lower())
  await tenantDb.field.where({ label: "baseline" }).max(field => field.label.lower())
  await tenantDb.field.pluck(field => field.answers.count())
  await tenantDb.field.where({ label: "baseline" }).max(field => field.answers.count())
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
  await tenantDb.field.pluck(field => coalesce(field.position, 1))
  await tenantDb.field.select(field => ({
    value: greatest(field.answers.count(), field.position),
  }))
  await tenantDb.field.pluck(field => caseWhen(t.integer, [[field.label.eq("baseline"), 1]], 0))
  await tenantDb.field.where({ label: "baseline" }).exists()
  await tenantDb.field.where(field => not(field.answers.exists())).pluck("id")
  await tenantDb.field
    .where({ label: tenantDb.answer.where({ value: "baseline" }).get("value") })
    .pluck("id")
  await tenantDb.field.where(field => field.position.lt(field.answers.count())).pluck("id")
  await storeDb.brand.where(brand => brand.products.count().expr().gt(1)).pluck("id")
  await storeDb.supplier.orderBy(supplier => desc(supplier.email)).pluck("name")
  await storeDb.supplier.orderBy(() => desc(storeDb.review.count())).pluck("email")
  await storeDb.supplier.where(supplier => supplier.id.in(["baseline"])).pluck("name")
  await storeDb.review
    .where(review => review.id.in(storeDb.supplier.where({ email: "baseline" }).pluck("id")))
    .pluck("productId")
  await tenantDb.$execute(
    formsSchema.field
      .where({ label: "baseline" })
      .select("label")
      .select(field => ({
        hasForm: field.form.exists(),
      })),
  )
  await tenantDb.field.select("id").use(withLabel)
  await tenantDb.field
    .insert({ id: "baseline", formId: "baseline", position: 1, label: "baseline" })
    .use(withLabel)
  await tenantDb.form.select("published").use(withPositions)
  await tenantDb.$select({
    ids: tenantDb.form.pluck("id"),
    positions: tenantDb.field.pluck("position"),
  })
  await tenantDb.field
    .insert({ id: "baseline", formId: "baseline", position: 1, label: "baseline" })
    .get("id")
  await tenantDb.field.find("baseline").update({ label: "baseline" }).select("label", "position")
  await tenantDb.field.find("baseline").update({
    label: tenantDb.answer.min("value").coalesce("baseline"),
  })
  await tenantDb.field.find("baseline").update(field => ({
    label: field.label.lower(),
  }))
  await tenantDb.field
    .find("baseline")
    .delete()
    .get(field => field.label.lower())
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
}).types([395, "instantiations"])

bench("filter of a callback", async () => {
  await tenantDb.form.where(form => form.name.eq("x")).pluck("name")
}).types([231, "instantiations"])

bench("filter of matches", async () => {
  await tenantDb.form.where(form => matches(form, { name: "x" })).pluck("name")
}).types([521, "instantiations"])

bench("find", async () => {
  await tenantDb.form.find("x").select("name")
}).types([271, "instantiations"])

bench("findBy", async () => {
  await tenantDb.form.findBy({ id: "x" }).select("name")
}).types([298, "instantiations"])

bench("count", async () => {
  await tenantDb.form.where({ name: "x" }).count()
}).types([141, "instantiations"])

bench("aggregate of a column", async () => {
  await tenantDb.form.where({ name: "x" }).max("name")
}).types([159, "instantiations"])

bench("aggregate with a fallback", async () => {
  await tenantDb.form.where({ name: "x" }).max("name").coalesce("x")
}).types([273, "instantiations"])

bench("function of a column", async () => {
  await tenantDb.form.pluck(form => coalesce(form.name, "x"))
}).types([242, "instantiations"])

bench("case conversion of a column", async () => {
  await tenantDb.form.pluck(form => form.name.lower())
}).types([178, "instantiations"])

bench("get of a callback", async () => {
  await tenantDb.form.find("x").get(form => form.name.lower())
}).types([315, "instantiations"])

bench("aggregate of a callback", async () => {
  await tenantDb.form.where({ name: "x" }).max(form => form.name.lower())
}).types([209, "instantiations"])

bench("value of an aggregate of a relation", async () => {
  await tenantDb.form.pluck(form => form.fields.count())
}).types([393, "instantiations"])

bench("aggregate of an aggregate of a relation", async () => {
  await tenantDb.form.where({ name: "x" }).max(form => form.fields.count())
}).types([428, "instantiations"])

bench("function of an aggregate of a relation and a value", async () => {
  await tenantDb.form.select(form => ({
    value: greatest(form.fields.count(), 1),
  }))
}).types([608, "instantiations"])

bench("case of two branches", async () => {
  await tenantDb.form.pluck(form =>
    caseWhen(
      t.text,
      [
        [form.name.eq("x"), "a"],
        [form.published, form.name],
      ],
      "b",
    ),
  )
}).types([589, "instantiations"])

bench("exists", async () => {
  await tenantDb.form.where({ name: "x" }).exists()
}).types([141, "instantiations"])

bench("filter of exists of a relation", async () => {
  await tenantDb.form.where(form => not(form.fields.exists())).pluck("name")
}).types([387, "instantiations"])

bench("filter of a value of a query", async () => {
  await tenantDb.field
    .where({ formId: tenantDb.form.where({ name: "x" }).get("id") })
    .pluck("label")
}).types([753, "instantiations"])

bench("filter of a list", async () => {
  await tenantDb.form.where(form => form.id.in(["x", "y"])).pluck("name")
}).types([287, "instantiations"])

bench("filter of the values of a query", async () => {
  await tenantDb.field
    .where(field => field.formId.in(tenantDb.form.where({ name: "x" }).pluck("id")))
    .pluck("label")
}).types([262, "instantiations"])

bench("comparison with an aggregate of a relation", async () => {
  await tenantDb.field.where(field => field.label.eq(field.answers.min("value"))).pluck("label")
}).types([509, "instantiations"])

bench("comparison of an aggregate of a relation", async () => {
  await tenantDb.form.where(form => form.fields.count().expr().gt(3)).pluck("name")
}).types([400, "instantiations"])

bench("order of a callback", async () => {
  await tenantDb.form.orderBy(form => desc(form.name)).pluck("name")
}).types([175, "instantiations"])

bench("order by an aggregate of a relation", async () => {
  await tenantDb.form.orderBy(form => desc(form.fields.count())).pluck("name")
}).types([302, "instantiations"])

bench("helper", async () => {
  await tenantDb.form.select("id").use(withName)
}).types([1070, "instantiations"])

bench("helper of relations", async () => {
  await tenantDb.form.select("id").use(withFieldIds)
}).types([1156, "instantiations"])

bench("insert with a helper", async () => {
  await tenantDb.form.insert({ id: "x", name: "x", published: true }).use(withName)
}).types([1175, "instantiations"])

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
}).types([964, "instantiations"])

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
}).types([964, "instantiations"])

bench("relation many", async () => {
  await tenantDb.$execute(
    formsSchema.form
      .where({ id: "x" })
      .select("id")
      .select(form => ({
        fields: form.fields.select("label", "position"),
      })),
  )
}).types([1042, "instantiations"])

bench("relation one", async () => {
  await tenantDb.$execute(
    formsSchema.field
      .where({ id: "x" })
      .select("id")
      .select(field => ({
        form: field.form.select("name", "published"),
      })),
  )
}).types([857, "instantiations"])

bench("exists of a relation", async () => {
  await tenantDb.$execute(
    formsSchema.form
      .where({ id: "x" })
      .select("id")
      .select(form => ({
        hasFields: form.fields.exists(),
      })),
  )
}).types([1039, "instantiations"])

bench("filtered relation one", async () => {
  await tenantDb.$execute(
    formsSchema.field
      .where({ id: "x" })
      .select("id")
      .select(field => ({
        form: field.form.where({ published: true }).select("name", "published"),
      })),
  )
}).types([1341, "instantiations"])

bench("root query of a deep relation graph", async () => {
  await storeDb.customer.where({ name: "x" }).select("name")
}).types([292, "instantiations"])

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
}).types([3494, "instantiations"])

bench("$select", async () => {
  await tenantDb.$select({
    names: tenantDb.form.pluck("name"),
    labels: tenantDb.field.pluck("label"),
  })
}).types([581, "instantiations"])

bench("insert", async () => {
  await tenantDb.form.insert({ id: "x", name: "x", published: true }).get("id")
}).types([523, "instantiations"])

bench("update", async () => {
  await tenantDb.form.find("x").update({ name: "x" }).select("id", "name")
}).types([519, "instantiations"])

bench("update of a value of a query", async () => {
  await tenantDb.form.find("x").update({
    name: tenantDb.field.min("label").coalesce("x"),
  })
}).types([368, "instantiations"])

bench("update of a callback", async () => {
  await tenantDb.form.find("x").update(form => ({
    name: form.name.lower(),
  }))
}).types([324, "instantiations"])

bench("update of an aggregate of a relation", async () => {
  await tenantDb.form.find("x").update(form => ({
    name: form.fields.min("label").coalesce("x"),
  }))
}).types([823, "instantiations"])

bench("delete with get of a callback", async () => {
  await tenantDb.form
    .find("x")
    .delete()
    .get(form => form.name.lower())
}).types([327, "instantiations"])

bench("unbound delete", async () => {
  await tenantDb.$execute(formsSchema.form.where({ name: "x" }).delete().pluck("id"))
}).types([249, "instantiations"])
