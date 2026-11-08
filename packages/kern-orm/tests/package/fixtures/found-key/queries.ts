// Queries by `id` and by `tenantId` and `id`, which stay distinct for `upsert` with `strictNullChecks` alone.
import type { FoundKey, QueryStateOf, SelectQuery, SelectQueryKind } from "kern-orm"
import { defineSchema, defineTable } from "kern-orm"
import * as t from "kern-orm/types"

const item = defineTable(
  "item",
  {
    id: t.uuid.primaryKey(),
    tenantId: t.uuid,
    title: t.text,
  },
  { unique: [["tenantId", "id"]] },
)
const schema = defineSchema({ item })

let byTenant = schema.item.findBy({ tenantId: "tenant-id", id: "item-id" })
// @ts-expect-error The query gives `id` but not `tenantId`.
byTenant = schema.item.find("item-id")

function upsertByTenant(query: typeof byTenant) {
  return query.upsert({ title: "A" })
}
// @ts-expect-error The query gives `id` but not `tenantId`.
upsertByTenant(schema.item.find("item-id"))

function upsertByState(
  query: SelectQuery<QueryStateOf<typeof item> & FoundKey<"tenantId" | "id">, SelectQueryKind>,
) {
  return query.upsert({ title: "A" })
}
upsertByState(schema.item.findBy({ tenantId: "tenant-id", id: "item-id" }))
// @ts-expect-error The query gives `id` but not `tenantId`.
upsertByState(schema.item.find("item-id"))
