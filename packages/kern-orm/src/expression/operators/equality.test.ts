import { describe, expect, it } from "bun:test"

import { createRecordingDriver } from "../../../testing/recording-driver"
import { falseNode } from "../../ast/nodes"
import { createDatabase } from "../../execution/database"
import type { AnySelectQuery } from "../../query/select"
import { from } from "../../query/select"
import { defineSchema } from "../../schema/schema"
import { defineTable } from "../../table/table"
import { defineType } from "../../type/type"
import * as t from "../../types"
import { param } from "../sql"

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

it("in takes the distinct values of a query", () => {
  expect(
    from(user)
      .where(columns => columns.id.in(from(user).pluck("id").distinct()))
      .toSQL().text,
  ).toBe(
    'SELECT FROM "user" AS "user" WHERE "user"."id" IN (SELECT DISTINCT "user_2"."id" AS "id" FROM "user" AS "user_2")',
  )
})

it("in takes the values of a query of any rows as a subquery of its statement, also of exists", () => {
  expect(
    from(user)
      .where(columns =>
        columns.id.in(from(user).where({ id: "user-id" }).orderBy("id").limit(10).pluck("id")),
      )
      .toSQL(),
  ).toEqual({
    text: 'SELECT FROM "user" AS "user" WHERE "user"."id" IN (SELECT "user_2"."id" AS "id" FROM "user" AS "user_2" WHERE "user_2"."id" = $1 ORDER BY "user_2"."id" LIMIT $2)',
    parameters: ["user-id", "10"],
  })
  expect(
    from(user)
      .where(() => param(t.boolean, true).in(from(user).exists()))
      .toSQL(),
  ).toEqual({
    text: 'SELECT FROM "user" AS "user" WHERE $1::boolean IN (SELECT EXISTS (SELECT FROM "user" AS "user_2") AS "exists")',
    parameters: ["t"],
  })
})

it("in rejects a query of records, and a value other than an array or a query of a table", () => {
  const db = createDatabase({ driver: createRecordingDriver().driver }).bind(defineSchema({ user }))
  // Types reject these values, which a query held as any query can still take.
  const records: AnySelectQuery = from(user)

  expect(() => from(user).where(columns => columns.id.in(records))).toThrow(
    "in takes a query of values, such as of pluck, not a query of records",
  )
  for (const value of [
    db.$select({}),
    db.user.insert({ id: "user-id" }).get("id"),
    db.$query`SELECT TRUE`,
    param(t.uuid, "user-id"),
    new Set(["user-id"]),
  ]) {
    expect(() => from(user).where(columns => columns.id.in(value as never))).toThrow(
      "in takes an array or a query of values of a table, such as of pluck",
    )
  }
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
