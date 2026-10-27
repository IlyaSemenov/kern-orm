// Instantiations that one more table definition, schema with relations, or the first filter or helper of a table adds to a consumer that already defines one of each kind.
// The count in `.types([...])` is the one that `bun run --cwd benchmarks bench:types -u` wrote; a run prints the change from it.

import { bench } from "@ark/attest"
import { defineFilter, defineHelper, defineSchema, defineTable, many, one } from "kern-orm"
import * as t from "kern-orm/types"

import { formsSchema } from "./fixture.ts"

const node = defineTable("node", {
  id: t.uuid.primaryKey(),
  parentId: t.uuid,
})

bench.baseline(() => {
  defineTable("baselineItem", {
    id: t.uuid.primaryKey(),
    code: t.text,
    shelf: t.integer,
    slot: t.integer,
    parentId: t.uuid,
  })
  defineTable(
    "baselineKeyedItem",
    {
      id: t.uuid.primaryKey(),
      code: t.text.unique(),
      shelf: t.integer,
      slot: t.integer,
      parentId: t.uuid,
    },
    { unique: [["shelf", "slot"]] },
  )
  const baselineNode = defineTable("baselineNode", {
    id: t.uuid.primaryKey(),
    parentId: t.uuid,
  })
  defineSchema({ baselineNode }).$relations({
    baselineNode: {
      parent: one(baselineNode, { from: "parentId", to: "id" }),
      children: many(baselineNode, { from: "id", to: "parentId" }),
    },
  })
  defineFilter(formsSchema.field, { label: "baseline" })
  defineHelper(formsSchema.field, query => query.where({ label: "baseline" }))
})

bench("table", () => {
  defineTable("item", {
    id: t.uuid.primaryKey(),
    code: t.text,
    shelf: t.integer,
    slot: t.integer,
    parentId: t.uuid,
  })
}).types([247, "instantiations"])

bench("table with keys", () => {
  defineTable(
    "keyedItem",
    {
      id: t.uuid.primaryKey(),
      code: t.text.unique(),
      shelf: t.integer,
      slot: t.integer,
      parentId: t.uuid,
    },
    { unique: [["shelf", "slot"]] },
  )
}).types([298, "instantiations"])

bench("schema with relations", () => {
  defineSchema({ node }).$relations({
    node: {
      parent: one(node, { from: "parentId", to: "id" }),
      children: many(node, { from: "id", to: "parentId" }),
    },
  })
}).types([1216, "instantiations"])

bench("first filter of a table", () => {
  defineFilter(formsSchema.form, { name: "x" })
}).types([497, "instantiations"])

bench("first helper of a table", () => {
  defineHelper(formsSchema.form, query => query.where({ published: true }))
}).types([386, "instantiations"])
