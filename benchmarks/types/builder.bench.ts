// Instantiations that the columns of a query builder add to a consumer that already created columns of other keys and read them in a query of SQL text: the cost of each further call of `createSqlColumns`.
// The count in `.types([...])` is the one that `bun run --cwd benchmarks bench:types -u` wrote; a run prints the change from it.

import { bench } from "@ark/attest"
import type { SqlColumn } from "kern-orm/db/builder"
import { createSqlColumns } from "kern-orm/db/builder"
import * as t from "kern-orm/types"

import { storeDb, tenantDb } from "./fixture.ts"

// Columns that a list takes at runtime, so that its type does not tell each column; as many as a table of a real schema has.
const fieldId = { key: "id", name: "id", type: t.uuid } as const
const fieldColumns: (
  | SqlColumn<"label", typeof t.text>
  | SqlColumn<"position", typeof t.integer>
  | SqlColumn<"formId", typeof t.uuid>
  | SqlColumn<"required", typeof t.boolean>
  | SqlColumn<"hint", ReturnType<typeof t.text.nullable>>
  | SqlColumn<"createdAt", typeof t.timestamptz>
  | SqlColumn<"updatedAt", typeof t.timestamptz>
  | SqlColumn<"weight", typeof t.doublePrecision>
  | SqlColumn<"placeholder", typeof t.text>
  | SqlColumn<"minLength", typeof t.integer>
  | SqlColumn<"maxLength", typeof t.integer>
  | SqlColumn<"pattern", ReturnType<typeof t.text.nullable>>
  | SqlColumn<"hidden", typeof t.boolean>
  | SqlColumn<"readOnly", typeof t.boolean>
  | SqlColumn<"section", typeof t.text>
  | SqlColumn<"sectionId", typeof t.uuid>
  | SqlColumn<"archivedAt", typeof t.timestamptz>
  | SqlColumn<"score", typeof t.doublePrecision>
  | SqlColumn<"locale", typeof t.text>
  | SqlColumn<"revision", typeof t.integer>
)[] = []
const brandColumns: SqlColumn<"name", typeof t.text>[] = []

bench.baseline(async () => {
  // Other columns, as for the columns below.
  const rows = await storeDb.$query`SELECT`.select({
    brand: createSqlColumns([{ key: "sku", name: "sku", type: t.text }, ...brandColumns], {
      alias: "b",
    }),
  })
  const brand = rows[0]!.brand
  return [brand.sku, brand.name]
})

bench("columns of a builder", () => {
  createSqlColumns(
    [
      { key: "id", name: "id", type: t.uuid },
      { key: "label", name: "label", type: t.text },
      { key: "position", name: "position", type: t.integer },
      { key: "formId", name: "form_id", type: t.uuid },
    ],
    { alias: "d", key: ["id"] },
  )
}).types([287, "instantiations"])

bench("query of SQL text of the columns of a builder chosen at runtime", async () => {
  await tenantDb.$query`SELECT`.select({
    field: createSqlColumns([fieldId, ...fieldColumns], { alias: "d" }),
  })
}).types([587, "instantiations"])

bench("fields of the columns of a builder chosen at runtime", async () => {
  const rows = await tenantDb.$query`SELECT`.select({
    field: createSqlColumns([fieldId, ...fieldColumns], { alias: "d" }),
  })
  // Reading the fields computes their types, which a query alone leaves to its consumer.
  const field = rows[0]!.field
  return [field.id, field.label, field.position, field.formId]
}).types([742, "instantiations"])
