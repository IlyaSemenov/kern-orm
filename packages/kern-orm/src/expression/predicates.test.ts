import { describe, expect, it } from "bun:test"

import { falseNode, trueNode } from "../ast/nodes"
import { from } from "../query/select"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { Expression } from "./expression"
import { toExpression, toNode } from "./expression"
import { and, not, or } from "./predicates"
import { param, sql } from "./sql"

const user = defineTable("user", {
  id: t.uuid,
  name: t.text,
})
const predicate = (name: string) =>
  toExpression<boolean>(from(user).where({ name }).node.filters.user!)
const trueExpression = toExpression<boolean>(trueNode)
const falseExpression = toExpression<boolean>(falseNode)

describe("and", () => {
  it("yields TRUE without operands", () => {
    expect(toNode(and())).toBe(trueNode)
  })

  it("drops TRUE and is absorbed by FALSE", () => {
    const condition = predicate("Alice")
    expect(toNode(and(trueExpression, condition))).toBe(toNode(condition))
    expect(toNode(and(condition, falseExpression))).toBe(falseNode)
  })
})

describe("or", () => {
  it("yields FALSE without operands", () => {
    expect(toNode(or())).toBe(falseNode)
  })

  it("drops FALSE and is absorbed by TRUE", () => {
    const condition = predicate("Alice")
    expect(toNode(or(falseExpression, condition))).toBe(toNode(condition))
    expect(toNode(or(condition, trueExpression))).toBe(trueNode)
  })

  // Orchid ORM dropped the other branch: https://github.com/romeerez/orchid-orm/issues/842
  it("keeps the other branch when IN gets an empty list", () => {
    const query = from(user)
      .select("id")
      .where(columns => or(columns.id.in([]), columns.name.in(["Alice"])))

    expect(query.toSQL().text).toEndWith('WHERE "user"."name" IN ($1)')
  })
})

describe("not", () => {
  it("inverts constants", () => {
    expect(toNode(not(trueExpression))).toBe(falseNode)
    expect(toNode(not(falseExpression))).toBe(trueNode)
  })

  it("cancels a double negation", () => {
    const condition = predicate("Alice")
    expect(toNode(not(not(condition)))).toBe(toNode(condition))
  })
})

describe("object conditions", () => {
  it("match the columns of the query in a callback", () => {
    expect(
      from(user)
        .where(columns => or({ name: "Alice" }, columns.id.in(["user-id"])))
        .toSQL().text,
    ).toEndWith('WHERE "user"."name" = $1 OR "user"."id" IN ($2)')
  })

  it("match the columns of the query without a callback", () => {
    expect(
      from(user)
        .where(or({ name: "Alice" }, not({ name: "Bob" })))
        .toSQL().text,
    ).toEndWith('WHERE "user"."name" = $1 OR NOT "user"."name" = $2')
  })

  it("simplify an empty object after resolution", () => {
    expect(
      from(user)
        .where(or({}, { name: "Alice" }))
        .toSQL().text,
    ).not.toContain("WHERE")
  })

  it("match a column with the eq of its type, including a replaced one", () => {
    const caseless = t.text.withOperators({
      eq: (self, value: string) => sql<boolean>`lower(${self}) = lower(${value})`,
    })
    const account = defineTable("account", {
      email: caseless,
      aliases: t.array(caseless),
    })

    expect(from(account).where({ email: "a@example.com", aliases: [] }).toSQL().text).toEndWith(
      'WHERE (lower("account"."email") = lower($1)) AND "account"."aliases" = $2',
    )
  })

  it("match a column with an eq of a type without SQL equality, and null with IS NULL", () => {
    const jsonWithEq = t.json.withOperators({
      eq: (self, value: object) => sql<boolean>`${self}::jsonb = ${param(t.jsonb, value)}`,
    })
    const account = defineTable("account", {
      settings: jsonWithEq.nullable(),
    })

    const query = from(account)
      .where({ settings: { theme: "dark" } })
      .toSQL()
    expect(query.text).toEndWith('WHERE "account"."settings"::jsonb = ($1::jsonb)')
    expect(query.parameters).toEqual(['{"theme":"dark"}'])
    expect(from(account).where({ settings: null }).toSQL().text).toEndWith(
      'WHERE "account"."settings" IS NULL',
    )
  })

  it("reject an eq that does not return an expression", () => {
    const broken = t.text.withOperators({
      eq: (_self, _value: string) => true as unknown as Expression<boolean>,
    })
    const account = defineTable("account", {
      email: broken,
    })

    expect(() => from(account).where({ email: "a@example.com" })).toThrow(
      'The eq operator of column "email" of table "account" must return an expression',
    )
  })

  describe("of columns without eq", () => {
    const event = defineTable("event", {
      payload: t.json,
      tags: t.array(t.json),
    })

    it("match only null", () => {
      expect(from(event).where({ payload: null }).toSQL().text).toEndWith(
        'WHERE "event"."payload" IS NULL',
      )
    })

    it("reject other values", () => {
      for (const values of [{ payload: { a: 1 } }, { tags: [] }]) {
        // @ts-expect-error A column without eq matches only null.
        expect(() => from(event).where(or(values))).toThrow("has no eq operator")
      }
    })
  })
})
