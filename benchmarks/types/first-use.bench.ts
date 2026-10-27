// Instantiations that the first use of a Db adds to a consumer that only defines its schemas and Dbs.
// The count in `.types([...])` is the one that `bun run --cwd benchmarks bench:types -u` wrote; a run prints the change from it.

import { bench } from "@ark/attest"
import type { DbOf } from "kern-orm"

import { catalogSchema, formsDb, formsSchema, storeDb, tenantDb } from "./fixture.ts"

bench("DbOf assignment of 2 tables", () => {
  const sharedDb: DbOf<typeof formsSchema> = tenantDb
  return sharedDb
}).types([1788, "instantiations"])

bench("DbOf assignment of 12 tables", () => {
  const sharedDb: DbOf<typeof catalogSchema> = storeDb
  return sharedDb
}).types([2593, "instantiations"])

bench("first unbound query", async () => {
  await formsDb.$execute(
    formsSchema.form
      .where({ id: "x" })
      .select("id", "name")
      .select(form => ({
        title: form.name,
      }))
      .take(),
  )
}).types([2643, "instantiations"])

// Nests 6 levels of relations, from orders down to the parent category, with sibling relations on the way.
bench("first query of a deep relation graph", async () => {
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
}).types([6964, "instantiations"])
