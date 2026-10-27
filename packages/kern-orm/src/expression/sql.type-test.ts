import { describe, expectTypeOf, test } from "bun:test"

import { from } from "../query/select"
import type { ExpressionValue } from "../query/selection"
import { defineTable } from "../table/table"
import { text } from "../type/builtins"
import { defineType } from "../type/type"
import * as t from "../types"

import type { Operand } from "./operators/comparison"
import { param, sql } from "./sql"

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

describe("param", () => {
  const numericCode = defineType({ sqlType: "text" }).withOperators({
    eq: (self, value: number) => sql<boolean>`${self} = ${value.toFixed(0)}`,
  })
  const coded = defineTable("coded", {
    code: numericCode,
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

  test("keeps null of an operand that may be an expression", () => {
    const createParameter = (value: Operand<number>) => param(param(t.integer, 1), value)
    expectTypeOf<ExpressionValue<ReturnType<typeof createParameter>>>().toEqualTypeOf<
      number | null
    >()
  })
})
