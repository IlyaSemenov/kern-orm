import { expectTypeOf, test } from "bun:test"

import { from } from "../../query/select"
import { defineTable } from "../../table/table"
import { defineType } from "../../type/type"
import * as t from "../../types"
import type { Expression } from "../expression"
import { or } from "../predicates"
import { param, sql } from "../sql"

import { equalityOperators } from "./equality"
import { orderingOperators } from "./ordering"

const doc = defineTable("doc", {
  body: t.json,
  note: t.json.nullable(),
  meta: t.jsonb,
  tags: t.array(t.text),
  parts: t.array(t.json),
})

test("equality operators are absent on types without SQL equality", () => {
  // @ts-expect-error PostgreSQL json has no `=`.
  from(doc).where(columns => columns.body.eq({}))

  // @ts-expect-error PostgreSQL json has no `=`.
  from(doc).where(columns => columns.body.in([{}]))

  // @ts-expect-error An array of json has no `=`.
  from(doc).where(columns => columns.parts.ne([]))

  from(doc).where(columns => columns.body.isNull())
})

test("equality operators exist on types with SQL equality", () => {
  from(doc).where(columns => columns.meta.eq({}))
  from(doc).where(columns => columns.tags.eq(["a"]))
})

test("equality operators come from equalityOperators or orderingOperators", () => {
  const ltree = defineType({ sqlType: "ltree" })
  // @ts-expect-error A type without operators has no `=`.
  param(ltree, "a").eq("a")

  param(ltree.withOperators(equalityOperators), "a").eq("a")
  param(ltree.withOperators(orderingOperators), "a").ne("a")
})

test("object conditions accept only null for columns without eq", () => {
  from(doc).where({ meta: {}, tags: [], body: null, note: null })
  from(defineTable("log", { body: t.json })).where({ body: null })

  // @ts-expect-error A column without eq matches only null.
  from(doc).where({ body: {} })

  // @ts-expect-error A column without eq matches only null.
  from(defineTable("log", { body: t.json })).where({ body: { a: 1 } })

  // @ts-expect-error A column without eq matches only null.
  from(doc).where(or({ parts: [] }, { meta: {} }))
})

test("equality operators are kept after eq is replaced", () => {
  const caseless = t.text.withOperators({
    eq: (self, value: string) => sql<boolean>`lower(${self}) = lower(${value})`,
  })
  const account = defineTable("account", {
    email: caseless,
    aliases: t.array(caseless),
  })

  from(account).where({ email: "a@example.com", aliases: [] })
  from(account).where(columns => columns.aliases.eq([]))
})

test("equality operators are not given by another operator named eq", () => {
  const jsonWithEq = t.json.withOperators({
    eq: (self, value: unknown) => sql<boolean>`${self}::jsonb = ${param(t.jsonb, value)}`,
  })
  const log = defineTable("log", {
    parts: t.array(jsonWithEq),
  })

  // @ts-expect-error An array of json has no `=`.
  from(log).where(columns => columns.parts.eq([]))
})

test("in is nullable when the expression or a list item is, except for an empty list", () => {
  const value = param(t.integer, 1)
  const nullable = param(t.integer.nullable(), null)

  expectTypeOf(value.in([1, value])).toEqualTypeOf<Expression<boolean>>()
  expectTypeOf(value.in([1, nullable])).toEqualTypeOf<Expression<boolean | null>>()
  expectTypeOf(nullable.in([1])).toEqualTypeOf<Expression<boolean | null>>()
  expectTypeOf(nullable.in([])).toEqualTypeOf<Expression<boolean>>()
  const empty = [] as const
  expectTypeOf(nullable.in(empty)).toEqualTypeOf<Expression<boolean>>()
  const dynamic: number[] = []
  expectTypeOf(nullable.in(dynamic)).toEqualTypeOf<Expression<boolean | null>>()
})

test("in takes a query of values of its type, nullable as the expression or the values", () => {
  const account = defineTable("account", {
    rank: t.integer,
    score: t.integer.nullable(),
    email: t.text,
  })
  const value = param(t.integer, 1)
  const nullable = param(t.integer.nullable(), null)

  expectTypeOf(value.in(from(account).pluck("rank"))).toEqualTypeOf<Expression<boolean>>()
  expectTypeOf(value.in(from(account).get("rank"))).toEqualTypeOf<Expression<boolean>>()
  expectTypeOf(value.in(from(account).count())).toEqualTypeOf<Expression<boolean>>()
  expectTypeOf(value.in(from(account).pluck("score"))).toEqualTypeOf<Expression<boolean | null>>()
  expectTypeOf(value.in(from(account).max("rank"))).toEqualTypeOf<Expression<boolean | null>>()
  expectTypeOf(nullable.in(from(account).pluck("rank"))).toEqualTypeOf<Expression<boolean | null>>()

  // @ts-expect-error A query of records has no values to compare.
  value.in(from(account).select("rank"))
  // @ts-expect-error The values of the query are of another type.
  value.in(from(account).pluck("email"))
  // @ts-expect-error A copy of a query is not a query.
  value.in({ ...from(account).pluck("rank") })
})
