import { expectTypeOf, test } from "bun:test"

import { from } from "../../query/select"
import { defineTable } from "../../table/table"
import * as t from "../../types"
import type { Expression } from "../expression"
import { param, sql } from "../sql"

import { compare } from "./comparison"

const value = param(t.integer, 1)
const nullable = param(t.integer.nullable(), null)

test("comparisons take non-null values of the column type", () => {
  const account = defineTable("account", {
    email: t.text,
    nickname: t.text.nullable(),
  })

  // @ts-expect-error Comparisons take non-null values; `isNull` matches NULL.
  from(account).where(columns => columns.nickname.eq(null))

  // @ts-expect-error Compared values are typed by the expression.
  from(account).where(columns => columns.email.in([1]))
})

test("comparisons are nullable when either side is", () => {
  for (const operator of ["eq", "ne", "lt", "lte", "gt", "gte"] as const) {
    expectTypeOf(value[operator](1)).toEqualTypeOf<Expression<boolean>>()
    expectTypeOf(value[operator](value)).toEqualTypeOf<Expression<boolean>>()
    expectTypeOf(nullable[operator](1)).toEqualTypeOf<Expression<boolean | null>>()
    expectTypeOf(value[operator](nullable)).toEqualTypeOf<Expression<boolean | null>>()
    expectTypeOf(nullable[operator](nullable)).toEqualTypeOf<Expression<boolean | null>>()
  }
  expectTypeOf(compare(value, "=", 1)).toEqualTypeOf<Expression<boolean>>()
  expectTypeOf(compare(value, "=", nullable)).toEqualTypeOf<Expression<boolean | null>>()
  expectTypeOf(sql<number | null>`value`.eq(1)).toEqualTypeOf<Expression<boolean | null>>()
  const date = param(t.timestamptz, new Date())
  expectTypeOf(date.gt(new Date())).toEqualTypeOf<Expression<boolean>>()
  // @ts-expect-error A nullable operand cannot be narrowed by the expected Boolean result.
  const result: Expression<boolean> = value.eq(nullable)
  void result
})

test("comparisons take a query of one value, nullable as its value or without its row", () => {
  const account = defineTable("account", {
    rank: t.integer,
    score: t.integer.nullable(),
    email: t.text,
  })
  const count = from(account).count()
  const max = from(account).max("rank")
  const rank = from(account).get("rank")

  expectTypeOf(value.lt(count)).toEqualTypeOf<Expression<boolean>>()
  expectTypeOf(value.lt(max)).toEqualTypeOf<Expression<boolean | null>>()
  expectTypeOf(value.eq(rank)).toEqualTypeOf<Expression<boolean | null>>()
  expectTypeOf(value.in([count, 1])).toEqualTypeOf<Expression<boolean>>()
  expectTypeOf(value.in([rank])).toEqualTypeOf<Expression<boolean | null>>()
  expectTypeOf(compare(value, "=", count)).toEqualTypeOf<Expression<boolean>>()
  from(account).where({ score: max })
  from(account).where({ rank: from(account).get("score") })

  // @ts-expect-error A query of records has no value to compare.
  value.eq(from(account).take())
  // @ts-expect-error A query of an array of values has no value to compare.
  value.eq(from(account).pluck("rank"))
  // @ts-expect-error The value of the query is of another type.
  value.eq(from(account).get("email"))
  // @ts-expect-error The value of the query is of another type.
  from(account).where({ email: count })
  // @ts-expect-error A copy of a query is not a query.
  value.eq({ ...count })
})

test("Boolean results can be compared again", () => {
  expectTypeOf(nullable.eq(1).eq(true)).toEqualTypeOf<Expression<boolean | null>>()
  expectTypeOf(nullable.isNull().eq(true)).toEqualTypeOf<Expression<boolean>>()
})
