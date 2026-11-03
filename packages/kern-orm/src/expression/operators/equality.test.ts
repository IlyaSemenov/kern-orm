import { describe, expect, it } from "bun:test"

import { falseNode } from "../../ast/nodes"
import { from } from "../../query/select"
import { defineTable } from "../../table/table"
import { defineType } from "../../type/type"
import * as t from "../../types"

import { equalityOperators, isEqualityCompatible } from "./equality"

const user = defineTable("user", {
  id: t.uuid,
})

it("in yields FALSE for an empty list", () => {
  expect(from(user).where(columns => columns.id.in([])).node.filters.user).toBe(falseNode)
})

it("in takes queries of one value in its list as scalar subqueries", () => {
  expect(
    from(user)
      .where(columns => columns.id.in([from(user).where({ id: "user-id" }).get("id"), "other-id"]))
      .toSQL(),
  ).toEqual({
    text: 'SELECT FROM "user" AS "user" WHERE "user"."id" IN ((SELECT "user_2"."id" AS "id" FROM "user" AS "user_2" WHERE "user_2"."id" = $1 LIMIT 1), $2)',
    parameters: ["user-id", "other-id"],
  })
})

describe("isEqualityCompatible", () => {
  it("accepts types of one SQL type, whatever their type parameters and representation", () => {
    const userId = t.uuid.transform({ decode: value => ({ userId: value }) })

    expect(isEqualityCompatible(t.uuid, t.uuid.nullable())).toBe(true)
    expect(isEqualityCompatible(t.uuid, userId)).toBe(true)
    expect(isEqualityCompatible(t.varchar.with(255), t.varchar.with(100))).toBe(true)
    expect(isEqualityCompatible(t.numeric.with(10, 2), t.numeric)).toBe(true)
    expect(isEqualityCompatible(t.char, t.char.with(5))).toBe(true)
    expect(isEqualityCompatible(t.array(t.integer), t.array(t.integer))).toBe(true)
  })

  it("accepts integer types and text types of one operator family", () => {
    expect(isEqualityCompatible(t.integer, t.bigint)).toBe(true)
    expect(isEqualityCompatible(t.smallint, t.bigint)).toBe(true)
    expect(isEqualityCompatible(t.varchar.with(255), t.text)).toBe(true)
  })

  it("rejects different SQL types, even of one TypeScript type", () => {
    expect(isEqualityCompatible(t.uuid, t.text)).toBe(false)
    expect(isEqualityCompatible(t.char, t.text)).toBe(false)
    expect(isEqualityCompatible(t.timestamp, t.timestamptz)).toBe(false)
    expect(isEqualityCompatible(t.integer, t.numeric)).toBe(false)
    expect(isEqualityCompatible(t.array(t.integer), t.array(t.bigint))).toBe(false)
  })

  it("rejects a type without SQL =", () => {
    const ltree = defineType({ sqlType: "ltree" })

    expect(isEqualityCompatible(t.json, t.json)).toBe(false)
    expect(isEqualityCompatible(ltree, ltree)).toBe(false)
    expect(isEqualityCompatible(ltree.withOperators(equalityOperators), ltree)).toBe(false)
    expect(
      isEqualityCompatible(
        ltree.withOperators(equalityOperators),
        ltree.withOperators(equalityOperators),
      ),
    ).toBe(true)
  })
})
