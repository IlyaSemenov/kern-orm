// Instantiations that one more type derived from a built-in one, custom type, or expression of a type adds to a consumer that already has one of each kind of other types.
// The count in `.types([...])` is the one that `bun run --cwd benchmarks bench:types -u` wrote; a run prints the change from it.

import { bench } from "@ark/attest"
import { defineTable, defineType, orderingOperators, param, sql } from "kern-orm"
import * as t from "kern-orm/types"

bench.baseline(() => {
  defineTable("baselineItem", {
    id: t.uuid.primaryKey(),
    note: t.varchar.nullable(),
    weight: t.real.transform({
      decode: value => String(value),
      encode: (value: string) => Number(value),
    }),
    at: t.timestamp.transform({ decode: value => new Date(value) }),
    kind: t.varchar.of<"x" | "y">(),
    code: t.varchar.with(10),
    size: t.real.nullable().transform({ decode: value => String(value) }),
    tags: t.array(t.varchar),
    status: t.enum("baseline_status", ["on", "off"]),
  })
  param(t.smallint, 1)
  void sql(t.smallint)`1`
  defineType({ sqlType: "citext" })
    .withOperators(orderingOperators)
    .withOperators({
      startsWith: (self, prefix: string) => sql(t.boolean)`starts_with(${self}, ${prefix})`,
    })
})

bench("nullable", () => {
  return t.text.nullable()
}).types([11, "instantiations"])

bench("transform with encode", () => {
  return t.numeric.transform({
    decode: value => Number(value),
    encode: (value: number) => String(value),
  })
}).types([113, "instantiations"])

bench("transform of decode", () => {
  return t.timestamptz.transform({ decode: value => new Date(value) })
}).types([89, "instantiations"])

bench("of", () => {
  return t.text.of<"a" | "b">()
}).types([20, "instantiations"])

bench("with", () => {
  return t.numeric.with(10, 2)
}).types([37, "instantiations"])

bench("chain of nullable, transform, and with", () => {
  return t.numeric
    .nullable()
    .transform({ decode: value => Number(value) })
    .with(10, 2)
}).types([139, "instantiations"])

bench("array", () => {
  return t.array(t.text)
}).types([133, "instantiations"])

bench("enum", () => {
  return t.enum("status", ["draft", "published"])
}).types([22, "instantiations"])

bench("table of derived types", () => {
  defineTable("item", {
    id: t.uuid.primaryKey(),
    note: t.text.nullable(),
    amount: t.numeric.with(10, 2).transform({ decode: value => Number(value) }),
    kind: t.text.of<"a" | "b">(),
  })
}).types([415, "instantiations"])

bench("param of a type", () => {
  return param(t.uuid, "x")
}).types([20, "instantiations"])

bench("sql of a type", () => {
  return sql(t.date)`CURRENT_DATE`
}).types([30, "instantiations"])

bench("custom type with an operator", () => {
  return defineType({ sqlType: "ltree" })
    .withOperators(orderingOperators)
    .withOperators({
      isAncestorOf: (self, other: string) => sql(t.boolean)`${self} @> ${param(self, other)}`,
    })
}).types([155, "instantiations"])
