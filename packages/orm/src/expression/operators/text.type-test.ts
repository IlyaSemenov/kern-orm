import { expectTypeOf, test } from "bun:test"

import { from } from "../../query/select"
import { defineTable } from "../../table/table"
import { defineType } from "../../type/type"
import * as t from "../../types"
import type { AnyExpression, Expression } from "../expression"
import { param, sql } from "../sql"

import { defineGenericOperator } from "./generic"
import { orderingOperators } from "./ordering"
import type { PatternSignature } from "./text"
import { textOperators } from "./text"

const account = defineTable("account", {
  id: t.uuid,
  verified: t.boolean,
  nickname: t.text.nullable(),
})

test("text operators exist on text columns", () => {
  from(account).where(columns => columns.nickname.ilike("%admin%"))
})

test("text operators are absent on other columns", () => {
  // @ts-expect-error Text operators exist only for strings.
  from(account).where(columns => columns.verified.like("t%"))

  // @ts-expect-error UUID columns have no text operators.
  from(account).where(columns => columns.id.ilike("a%"))
  // @ts-expect-error UUID columns have no conversion of case.
  from(account).where(columns => columns.id.lower().eq("a"))
})

test("text operators can only be added to types with string values", () => {
  defineType({ sqlType: "text" }).withOperators(textOperators)
  defineType({ sqlType: "text" }).nullable().withOperators(textOperators)

  // @ts-expect-error Pattern matching cannot be added to a numeric type.
  t.integer.withOperators(textOperators)
  // @ts-expect-error Mixing operator sets keeps the restriction on text operators.
  t.integer.withOperators({ ...orderingOperators, ...textOperators })
  // @ts-expect-error A single text operator also requires string values.
  t.integer.withOperators({ like: textOperators.like })
})

test("text operators survive a transform after they were added and take string patterns", () => {
  const tags = defineType({ sqlType: "text" })
    .withOperators(textOperators)
    .transform({
      decode: value => value.split(","),
      encode: (value: string[]) => value.join(","),
    })
  param(tags, ["a"]).like("a%")
  param(tags, ["a"]).ilike(param(t.text, "a%"))

  // @ts-expect-error A pattern is a string, not the transformed representation.
  param(tags, ["a"]).like(["a"])
})

test("pattern matching is nullable when either side is", () => {
  const name = param(t.text, "a")
  const nullableName = param(t.text.nullable(), null)

  for (const operator of ["like", "ilike"] as const) {
    expectTypeOf(name[operator]("a%")).toEqualTypeOf<Expression<boolean>>()
    expectTypeOf(nullableName[operator]("a%")).toEqualTypeOf<Expression<boolean | null>>()
    expectTypeOf(name[operator](nullableName)).toEqualTypeOf<Expression<boolean | null>>()
    const length = sql(t.text.nullable().transform({ decode: value => value.length }))`name`
    expectTypeOf(length[operator]("a%")).toEqualTypeOf<Expression<boolean | null>>()
  }
})

test("lower, upper, and trim give text, nullable when the expression is", () => {
  const name = param(t.text, "a")
  const nullableName = param(t.text.nullable(), null)
  const code = param(t.varchar.with(10), "a")
  const tags = sql(
    t.text.nullable().transform({
      decode: value => value.split(","),
      encode: (value: string[]) => value.join(","),
    }),
  )`tags`

  for (const operator of ["lower", "upper", "trim"] as const) {
    expectTypeOf(name[operator]()).toEqualTypeOf(sql(t.text)`name`)
    expectTypeOf(nullableName[operator]()).toEqualTypeOf(sql(t.text.nullable())`name`)
    expectTypeOf(code[operator]()).toEqualTypeOf(sql(t.text)`name`)
    expectTypeOf(tags[operator]()).toEqualTypeOf(sql(t.text.nullable())`name`)
  }
})

test("lower, upper, and trim give an expression with the operators of text", () => {
  const name = param(t.text.nullable(), null)

  expectTypeOf(name.lower().like("a%")).toEqualTypeOf<Expression<boolean | null>>()
  expectTypeOf(name.upper().lower().gt("a")).toEqualTypeOf<Expression<boolean | null>>()
  expectTypeOf(name.trim().like("a%")).toEqualTypeOf<Expression<boolean | null>>()

  // @ts-expect-error Text compares with strings.
  name.lower().eq(1)
})

test("length gives integer, nullable when the expression is", () => {
  const tags = sql(
    t.text.nullable().transform({
      decode: value => value.split(","),
      encode: (value: string[]) => value.join(","),
    }),
  )`tags`

  expectTypeOf(param(t.text, "a").length()).toEqualTypeOf(sql(t.integer)`length`)
  expectTypeOf(param(t.text.nullable(), null).length()).toEqualTypeOf(
    sql(t.integer.nullable())`length`,
  )
  expectTypeOf(param(t.varchar.with(10), "a").length()).toEqualTypeOf(sql(t.integer)`length`)
  expectTypeOf(tags.length()).toEqualTypeOf(sql(t.integer.nullable())`length`)
  expectTypeOf(param(t.text, "a").length().gt(1)).toEqualTypeOf<Expression<boolean>>()

  // @ts-expect-error A length is a number.
  param(t.text, "a").length().eq("1")
  // @ts-expect-error UUID columns have no length.
  from(account).where(columns => columns.id.length().eq(1))
})

test("custom pattern operators take string patterns and are added only to types of strings", () => {
  const similarTo = defineGenericOperator<PatternSignature, AnyExpression<string | null>>(
    (self, pattern) => sql(t.boolean)`${self} SIMILAR TO ${pattern}`,
  )
  const name = param(t.text.withOperators({ similarTo }), "a")
  const tags = t.text
    .nullable()
    .withOperators({ similarTo })
    .transform({
      decode: value => value.split(","),
      encode: (value: string[]) => value.join(","),
    })

  expectTypeOf(name.similarTo("a%")).toEqualTypeOf<Expression<boolean>>()
  expectTypeOf(name.similarTo(param(t.text.nullable(), null))).toEqualTypeOf<
    Expression<boolean | null>
  >()
  expectTypeOf(param(tags, null).similarTo("a%")).toEqualTypeOf<Expression<boolean | null>>()

  // @ts-expect-error A pattern is a string, not the transformed representation.
  param(tags, null).similarTo(["a"])
  // @ts-expect-error A pattern operator cannot be added to a numeric type.
  t.integer.withOperators({ similarTo })
})
