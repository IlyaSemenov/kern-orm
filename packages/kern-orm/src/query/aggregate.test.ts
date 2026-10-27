import { expect, it } from "bun:test"

import type { ScalarProjection } from "../ast/nodes"
import { sql } from "../expression/sql"
import { defineTable } from "../table/table"
import type { AnyType } from "../type/type"
import * as t from "../types"

import { countType, isAggregateQuery } from "./aggregate"
import type { AnySelectQuery } from "./select"
import { from } from "./select"

/** Text of `Number.MAX_SAFE_INTEGER`, the largest integer that a number holds exactly. */
const maxSafe = String(Number.MAX_SAFE_INTEGER)

/** Text of the integer after `Number.MAX_SAFE_INTEGER`, the first one that a number cannot hold exactly. */
const beyondSafe = String(BigInt(Number.MAX_SAFE_INTEGER) + 1n)

/** Type of `numeric` values truncated to `bigint` values, whose decoding reads the fractional value of an average. */
const truncated = t.numeric.transform({
  decode: text => BigInt(Math.trunc(Number(text))),
  encode: (value: bigint | number) => value,
})

const post = defineTable("post", {
  title: t.text,
  views: t.integer,
  stars: t.integer.transform({
    decode: stars => ({ stars }),
    encode: (value: { stars: number }) => value.stars,
  }),
  bytes: t.bigint,
  optionalBytes: t.bigint.nullable(),
  bytesText: t.bigint.transform({ decode: String }),
  truncatedTotal: truncated,
})

it("decodes a count as a number, rejecting a count outside the safe integer range", () => {
  expect(countType.decode(maxSafe)).toBe(Number.MAX_SAFE_INTEGER)
  expect(() => countType.decode(beyondSafe)).toThrow(
    `Count ${beyondSafe} is outside the safe integer range of numbers`,
  )
})

/** Type of the value of aggregate query `query`. */
function typeOf(query: AnySelectQuery): AnyType {
  return (query.node.projections[0] as ScalarProjection).type
}

it("decodes an aggregate by the type of its argument, and a count as a count", () => {
  expect(typeOf(from(post).max("title"))).toBe(t.text)
  expect(typeOf(from(post).sum("bytes"))).toBe(t.bigint)
  expect(typeOf(from(post).avg("views"))).toBe(t.integer)
  expect(typeOf(from(post).avg("truncatedTotal"))).toBe(truncated)
  expect(typeOf(from(post).count("title"))).toBe(countType)
  expect(typeOf(from(post).countDistinct("title"))).toBe(countType)
})

it("decodes a sum of integer values by their type, rejecting a sum outside the safe integer range", () => {
  const sum = typeOf(from(post).sum("views"))

  expect(typeOf(from(post).sum(columns => columns.views))).toBe(sum)
  expect(sum.decode(maxSafe)).toBe(Number.MAX_SAFE_INTEGER)
  expect(() => sum.decode(beyondSafe)).toThrow(
    `Sum ${beyondSafe} is outside the safe integer range of numbers`,
  )
  expect(() => sum.decode(`-${beyondSafe}`)).toThrow(
    `Sum -${beyondSafe} is outside the safe integer range of numbers`,
  )
  expect(sum.encode(0)).toBe("0")
  expect(typeOf(from(post).sum("stars")).decode("6")).toEqual({ stars: 6 })
})

it("rejects the average of bigint values unless an expression gives it a type that can represent fractional values", () => {
  for (const column of ["bytes", "optionalBytes", "bytesText"] as const) {
    expect(() => from(post).avg(column)).toThrow(
      "avg of bigint values requires a type that can represent fractional values; average a sql fragment of the column with t.doublePrecision or t.numeric",
    )
  }
  expect(typeOf(from(post).avg(columns => sql(t.doublePrecision)`${columns.bytes}`))).toBe(
    t.doublePrecision,
  )
})

it("tells an aggregate query, also after the methods that keep its value", () => {
  const aggregated = from(post)
    .max("title")
    .where({ title: "First" })
    .take()
    .optional()
    .coalesce("Untitled")

  expect(isAggregateQuery(from(post).count().node)).toBe(true)
  expect(isAggregateQuery(aggregated.node)).toBe(true)
  expect(isAggregateQuery(from(post).get("title").node)).toBe(false)
  expect(isAggregateQuery(from(post).node)).toBe(false)
})
