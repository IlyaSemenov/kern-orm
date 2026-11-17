import { expectTypeOf, test } from "bun:test"

import type { ResultOf } from "../../query/select"
import { from } from "../../query/select"
import { defineTable } from "../../table/table"
import { defineType } from "../../type/type"
import * as t from "../../types"
import { param } from "../sql"

import { arithmeticOperators } from "./arithmetic"

const account = defineTable("account", {
  visits: t.integer,
  bonus: t.integer.nullable(),
  level: t.smallint.of<1 | 2 | 3>(),
  total: t.bigint,
  balance: t.numeric,
  rate: t.doublePrecision,
  name: t.text,
  verified: t.boolean,
})

const accounts = from(account)

test("the result has the values of the expression and NULL when an operand can be NULL", () => {
  const query = accounts.select(columns => ({
    sum: columns.visits.add(1),
    nullableSelf: columns.bonus.add(1),
    nullableOperand: columns.visits.add(columns.bonus),
    total: columns.total.mul(2),
    balance: columns.balance.sub("0.5"),
  }))

  expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{
    sum: number
    nullableSelf: number | null
    nullableOperand: number | null
    total: bigint
    balance: string
  }>()
})

test("the result widens values narrowed with of", () => {
  const query = accounts.select(columns => ({
    level: columns.level.add(1),
  }))

  expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ level: number }>()

  accounts.where(columns => columns.level.add(5).gt(7))
})

test("the result keeps undefined that a decoder of transform returns", () => {
  const score = t.integer.transform({
    decode: value => (value === 0 ? undefined : { value }),
    encode: (score: { value: number }) => score.value,
  })
  const query = accounts.select(_columns => ({
    score: param(score, { value: 1 }).sub({ value: 1 }),
  }))

  expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{
    score: { value: number } | undefined
  }>()
})

test("operands are the values that the type accepts or expressions of its values", () => {
  accounts.where(columns => columns.total.add(1).gt(1n))
  accounts.where(columns => columns.balance.add(1).gt("1"))
  accounts.where(columns => columns.visits.add(columns.level).gt(1))
  accounts.where(columns => columns.visits.add(param(t.integer, 1)).gt(1))

  // @ts-expect-error An operand of an integer is a number.
  accounts.where(columns => columns.visits.add("1").gt(1))
  // @ts-expect-error A bigint expression is not an operand of an integer.
  accounts.where(columns => columns.visits.add(columns.total).gt(1))
  // @ts-expect-error A plain null is not an operand.
  accounts.where(columns => columns.visits.add(null).gt(1))
})

test("the result keeps the operators of the type", () => {
  accounts.where(columns => columns.visits.add(1).mod(2).eq(0))

  // @ts-expect-error Floating-point types have no mod.
  accounts.where(columns => columns.rate.add(1).mod(2).eq(0))
})

test("arithmetic operators are absent on other types", () => {
  // @ts-expect-error Text has no arithmetic operators.
  accounts.where(columns => columns.name.add("a").eq("b"))
  // @ts-expect-error Boolean has no arithmetic operators.
  accounts.where(columns => columns.verified.add(true).eq(true))
  // @ts-expect-error Floating-point types have no mod.
  accounts.where(columns => columns.rate.mod(2).eq(0))
})

test("arithmetic operators can be added only to types of numbers, bigints, or strings", () => {
  defineType({ sqlType: "integer" })
    .transform({ decode: Number, encode: (value: number) => String(value) })
    .withOperators(arithmeticOperators)

  // @ts-expect-error A Boolean type cannot take arithmetic operators.
  t.boolean.withOperators(arithmeticOperators)
})
