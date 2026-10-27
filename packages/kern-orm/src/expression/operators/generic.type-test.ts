import { expectTypeOf, test } from "bun:test"

import { from } from "../../query/select"
import { defineTable } from "../../table/table"
import * as t from "../../types"
import type { Expression } from "../expression"
import { param, sql } from "../sql"

import type { BooleanResult, Operand, OperandValue } from "./comparison"
import type { OperatorSignature } from "./generic"
import { defineGenericOperator } from "./generic"

interface Between extends OperatorSignature {
  readonly method: <
    Low extends Operand<this["T"], this["I"]>,
    High extends Operand<this["T"], this["I"]>,
  >(
    low: Low,
    high: High,
  ) => Expression<BooleanResult<this["T"] | OperandValue<Low | High>>>
}
const between = defineGenericOperator<Between>(
  (self, low, high) => sql(t.boolean)`${self} BETWEEN ${param(self, low)} AND ${param(self, high)}`,
)
const score = t.integer.withOperators({ between })
const event = defineTable("event", {
  rank: score,
  day: t.date.withOperators({ between }),
  level: score.transform({
    decode: String,
    encode: (value: string) => Number(value),
  }),
})

test("generic operators enforce the result types of their signatures", () => {
  defineGenericOperator<Between>(
    // @ts-expect-error Between requires a result with a type.
    (self, low, high) => sql<boolean>`${self} BETWEEN ${param(self, low)} AND ${param(self, high)}`,
  )
})

test("generic operators take operands of the expression type", () => {
  from(event).where(columns => columns.rank.between(1, 10))
  from(event).where(columns => columns.day.between("2026-01-01", "2026-02-01"))

  // @ts-expect-error Operands are typed by the expression.
  from(event).where(columns => columns.rank.between("1", 10))
})

test("generic operators take operands of a type derived after they were added", () => {
  from(event).where(columns => columns.level.between("1", columns.level))

  // @ts-expect-error Operands are typed by the derived type.
  from(event).where(columns => columns.level.between(1, 10))
})

test("generic operators infer Boolean nullability from self and both bounds", () => {
  const value = param(score, 5)
  const nullable = param(score.nullable(), null)
  expectTypeOf(value.between(1, 10)).toEqualTypeOf<Expression<boolean>>()
  expectTypeOf(nullable.between(1, 10)).toEqualTypeOf<Expression<boolean | null>>()
  expectTypeOf(value.between(nullable, 10)).toEqualTypeOf<Expression<boolean | null>>()
  expectTypeOf(value.between(1, nullable)).toEqualTypeOf<Expression<boolean | null>>()
})
