import { expect, it } from "bun:test"

import { from } from "../../query/select"
import { defineTable } from "../../table/table"
import * as t from "../../types"
import type { Expression } from "../expression"
import { param, sql } from "../sql"

import type { Operand } from "./comparison"
import type { OperatorSignature } from "./generic"
import { defineGenericOperator } from "./generic"

it("generic operators receive the expression with its own type", () => {
  interface Between extends OperatorSignature {
    readonly method: (
      low: Operand<this["T"], this["I"]>,
      high: Operand<this["T"], this["I"]>,
    ) => Expression<boolean>
  }
  const between = defineGenericOperator<Between>(
    (self, low, high) =>
      sql(t.boolean)`${self} BETWEEN ${param(self, low)} AND ${param(self, high)}`,
  )
  const rank = t.integer.withOperators({ between }).transform({
    decode: String,
    encode: (value: string) => Number(value),
  })
  const event = defineTable("event", {
    rank,
    limit: rank,
  })

  expect(
    from(event)
      .where(columns => columns.rank.between("1", columns.limit))
      .toSQL(),
  ).toMatchObject({
    text: 'SELECT FROM "event" AS "event" WHERE "event"."rank" BETWEEN $1 AND "event"."limit"',
    parameters: ["1"],
  })
})

it("generic operators compare with operands of a type derived after they were added", () => {
  const rank = t.integer.transform({
    decode: Number,
    encode: (value: string) => Number(value),
  })
  const event = defineTable("event", {
    rank,
  })

  expect(
    from(event)
      .where(columns => columns.rank.lt("10"))
      .toSQL().parameters,
  ).toEqual(["10"])
})
