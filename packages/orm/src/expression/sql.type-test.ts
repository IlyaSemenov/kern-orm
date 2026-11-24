import { describe, expectTypeOf, test } from "bun:test"

import { sql as sqlFragment } from "kern-db"

import type { ResultOf } from "../query/select"
import { from } from "../query/select"
import type { ExpressionValue } from "../query/selection"
import { defineTable } from "../table/table"
import { text } from "../type/builtins/text"
import { defineType } from "../type/type"
import * as t from "../types"

import type { AnyExpression } from "./expression"
import type { Operand } from "./operators/comparison"
import { joinSql, param, sql } from "./sql"

describe("sql", () => {
  const account = defineTable("account", {
    email: t.text,
  })

  test("is a condition inside `where`", () => {
    from(account).where(columns => sql`length(${columns.email}) > ${10}`)
  })

  test("needs a type argument to be a condition outside `where`", () => {
    const unknownFragment = sql`length(email) > 10`
    // @ts-expect-error A fragment outside `where` needs a type argument to be a condition.
    from(account).where(unknownFragment)
  })

  test("has the equality operators when typed by a TypeScript type", () => {
    sql<string>`lower(email)`.eq("a")

    // @ts-expect-error A fragment typed only by its TypeScript type has the equality operators only.
    from(account).where(columns => sql<string>`lower(${columns.email})`.ilike("a%"))
  })

  test("has the operators of a type it is given", () => {
    from(account).where(columns => sql(text)`lower(${columns.email})`.ilike("a%"))
  })
})

describe("joinSql", () => {
  const account = defineTable("account", {
    email: t.text,
  })

  test("joins expressions, fragments, and values with a separator of sql or of the database layer, into a condition inside `where`", () => {
    from(account).where(columns =>
      joinSql([columns.email.eq("a"), sql`${columns.email} LIKE ${"b%"}`], sql` OR `),
    )
    from(account).where(columns => joinSql([columns.email, "a"], sqlFragment` = `))
  })

  test("needs a type argument to be a condition outside `where`", () => {
    const unknownList = joinSql([sql`a`, sql`b`], sql` OR `)
    const conditionList = joinSql<boolean>([sql`a`, sql`b`], sql` OR `)

    // @ts-expect-error A list outside `where` needs a type argument to be a condition.
    from(account).where(unknownList)
    from(account).where(conditionList)
  })

  test("rejects a string separator", () => {
    // @ts-expect-error The separator is SQL, not a string.
    joinSql([1, 2], " AND ")
  })
})

describe("param", () => {
  const numericCode = defineType({ sqlType: "text" }).withOperators({
    eq: (self, value: number) => sql<boolean>`${self} = ${value.toFixed(0)}`,
  })
  const coded = defineTable("coded", {
    code: numericCode,
  })

  test("of a type is a constant that a query selects", () => {
    const query = from(coded).select(() => ({
      source: param(t.text, "form"),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ source: string }>()
  })

  test("of an expression and a plain value has the operators of the expression", () => {
    from(coded).where(columns => param(columns.code, "a").eq(1))

    // @ts-expect-error A parameter of a plain value has the operators of the expression.
    from(coded).where(columns => param(columns.code, "a").eq("b"))
  })

  test("returns an expression value with its own type", () => {
    const nullable = param(t.integer.nullable(), null)
    expectTypeOf(param(param(t.integer, 1), nullable)).toEqualTypeOf(nullable)
  })

  test("takes a query of one value as an expression of its value, nullable without its row", () => {
    const item = defineTable("item", {
      id: t.integer,
    })
    const value = param(t.integer, 1)

    expectTypeOf(param(value, from(item).get("id"))).toEqualTypeOf<AnyExpression<number | null>>()
    expectTypeOf(param(value, from(item).count())).toEqualTypeOf<AnyExpression<number>>()
    const fallback = from(item)
      .max("id")
      .coalesce(param(value, from(item).get("id")))
    expectTypeOf<ResultOf<typeof fallback>>().toEqualTypeOf<number | null>()
  })

  test("keeps null of an operand that may be an expression", () => {
    const createParameter = (value: Operand<number>) => param(param(t.integer, 1), value)
    expectTypeOf<ExpressionValue<ReturnType<typeof createParameter>>>().toEqualTypeOf<
      number | null
    >()
  })
})
