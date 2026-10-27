import { describe, expectTypeOf, test } from "bun:test"

import { from } from "../query/select"
import { defineTable } from "../table/table"
import { defineType } from "../type/type"
import * as t from "../types"

import type { Expression } from "./expression"
import { toExpression, toNode } from "./expression"
import { param, sql } from "./sql"

test("isNull is non-nullable", () => {
  expectTypeOf(param(t.integer.nullable(), null).isNull()).toEqualTypeOf<Expression<boolean>>()
})

test("sql<T> is not assignable to Expression<T>", () => {
  // @ts-expect-error `sql<T>` has no type to decode its values.
  const length: Expression<number> = sql<number>`length(name)`
  void length
})

test("toExpression without a type gives an expression that cannot be selected", () => {
  const account = defineTable("account", {
    name: t.text,
  })
  const length = toExpression<number>(toNode(sql`length(name)`))
  // @ts-expect-error An expression built without a type has no type to decode its values.
  from(account).get(() => length)
})

describe("custom operators", () => {
  const vector = defineType({ sqlType: "vector" })
    .transform({
      decode: text => JSON.parse(text) as number[],
      encode: (value: number[]) => JSON.stringify(value),
    })
    .withOperators({
      isWithin: (self, other: number[], distance: number) =>
        sql<boolean>`${self} <-> ${param(self, other)} < ${distance}`,
    })
  const doc = defineTable("doc", {
    embedding: vector.nullable(),
  })

  test("take arguments typed by their definition", () => {
    from(doc).where(columns => columns.embedding.isWithin([1, 2, 3], 0.5))

    // @ts-expect-error Operator arguments are typed by its definition.
    from(doc).where(columns => columns.embedding.isWithin("near", 0.5))
  })

  test("named eq type the values of object conditions", () => {
    const caseless = t.text.withOperators({
      eq: (self, value: string) => sql<boolean>`lower(${self}) = lower(${value})`,
    })
    const jsonWithEq = t.json.withOperators({
      eq: (self, value: object) => sql<boolean>`${self}::jsonb = ${param(t.jsonb, value)}`,
    })
    const account = defineTable("account", {
      email: caseless,
      settings: jsonWithEq.nullable(),
    })

    from(account).where({ email: "a@example.com", settings: { theme: "dark" } })
    from(account).where({ settings: null })

    // @ts-expect-error Values of object conditions are typed by eq.
    from(account).where({ email: 1 })

    // @ts-expect-error Values of object conditions are typed by eq.
    from(account).where({ settings: "dark" })
  })

  test("named eq with several operands limit object conditions to null", () => {
    const text = t.text.withOperators({
      eq: (self, value: string, other: string) => sql<boolean>`${self} IN (${value}, ${other})`,
    })
    const account = defineTable("account", {
      email: text.nullable(),
    })

    from(account).where({ email: null })

    // @ts-expect-error A column whose eq takes several operands matches only null.
    from(account).where({ email: "a@example.com" })
  })
})
