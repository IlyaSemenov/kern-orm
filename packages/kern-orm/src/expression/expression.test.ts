import { describe, expect, it } from "bun:test"

import { compileSelect } from "../compiler/postgres/compile"
import { lower } from "../lowering/testing"
import { from } from "../query/select"
import { decodeResult } from "../result/result"
import { defineTable } from "../table/table"
import { text } from "../type/builtins"
import { defineType } from "../type/type"
import * as t from "../types"

import { getType } from "./expression"
import { equalityOperators } from "./operators/equality"
import { and, not, or } from "./predicates"
import { param, sql } from "./sql"

const user = defineTable("user", {
  id: t.uuid,
  name: t.text,
})

describe("Boolean results", () => {
  const value = param(t.integer, 1)
  const name = param(t.text, "a")

  const results = [
    ["eq", value.eq(1)],
    ["ne", value.ne(1)],
    ["lt", value.lt(1)],
    ["lte", value.lte(1)],
    ["gt", value.gt(1)],
    ["gte", value.gte(1)],
    ["in", value.in([1])],
    ["in with an empty list", value.in([])],
    ["isNull", value.isNull()],
    ["like", name.like("a%")],
    ["ilike", name.ilike("a%")],
    ["and", and(value.eq(1), value.eq(2))],
    ["or", or(value.eq(1), value.eq(2))],
    ["not", not(value.eq(1))],
    ["empty and", and()],
    ["empty or", or()],
  ] as const

  it.each(results)("of %s have the Boolean type", (_name, expression) => {
    expect(getType(expression)).toBe(t.boolean)
  })

  it("decode PostgreSQL Boolean values and keep NULL", () => {
    const compiled = compileSelect(
      lower(
        from(user).select(() => ({
          result: value.eq(1),
        })),
      ),
    )
    expect(decodeResult(compiled, [["t"], ["f"], [null]])).toEqual([
      { result: true },
      { result: false },
      { result: null },
    ])
  })

  it("compare with Boolean values", () => {
    expect(from(user).where(value.eq(1).eq(true)).toSQL().parameters).toEqual(["1", "1", "t"])
  })
})

describe("operators of a type", () => {
  it("add custom operators to columns of the type", () => {
    const vector = defineType({ sqlType: "vector" })
      .transform({
        decode: text => JSON.parse(text) as number[],
        encode: (value: number[]) => JSON.stringify(value),
      })
      .withOperators({
        isWithin: (self, other: number[], distance: number) =>
          sql<boolean>`${self} <-> ${param(self, other)} < ${distance}`,
      })
      .withParameters((dimensions: number) => `vector(${dimensions})`)
    const doc = defineTable("doc", {
      embedding: vector.with(3),
    })

    expect(
      from(doc)
        .where(columns => columns.embedding.isWithin([1, 2, 3], 0.5))
        .toSQL(),
    ).toMatchObject({
      text: 'SELECT FROM "doc" AS "doc" WHERE "doc"."embedding" <-> $1 < $2',
      parameters: ["[1,2,3]", "0.5"],
    })
  })

  it("keep working on a type derived with transform", () => {
    const tags = t.text.transform({
      decode: value => value.split(","),
      encode: (value: string[]) => value.join(","),
    })
    const post = defineTable("post", {
      tags,
    })

    expect(
      from(post)
        .where(columns => and(columns.tags.like("a%"), columns.tags.eq(["a", "b"])))
        .toSQL().parameters,
    ).toEqual(["a%", "a,b"])
  })

  it("receive self with the operators of the type they were added to", () => {
    const code = defineType({ sqlType: "text" })
      .withOperators(equalityOperators)
      .withOperators({
        eq: (self, value: string) => self.ne(value),
        ne: (self, value: number) => sql<boolean>`${self} <> ${value.toFixed(0)}`,
      })
    const item = defineTable("item", {
      code,
    })

    expect(
      from(item)
        .where(columns => and(columns.code.eq("a"), columns.code.ne(1)))
        .toSQL(),
    ).toMatchObject({
      text: 'SELECT FROM "item" AS "item" WHERE "item"."code" <> $1 AND ("item"."code" <> $2)',
      parameters: ["a", "1"],
    })
  })

  it("may use the names of expression internals and of Object.prototype", () => {
    const tagged = defineType({ sqlType: "text" }).withOperators({
      ...equalityOperators,
      node: (self, value: string) => sql<boolean>`${self} = ${value}`,
      type: (self, value: string) => sql<boolean>`${self} <> ${value}`,
      ["__proto__"]: (self, value: string) => sql<boolean>`${self} > ${value}`,
    })
    const account = defineTable("account", {
      email: tagged,
    })

    expect(
      from(account)
        .where(columns =>
          and(
            columns.email.node("a"),
            columns.email.type("b"),
            columns.email["__proto__"]("c"),
            columns.email.eq("d"),
          ),
        )
        .toSQL().text,
    ).toEndWith(
      'WHERE ("account"."email" = $1) AND ("account"."email" <> $2) AND ("account"."email" > $3) AND "account"."email" = $4',
    )
  })

  it("reject the name then, which would make expressions thenable", () => {
    // oxlint-disable-next-line unicorn/no-thenable -- the test passes the forbidden name on purpose
    expect(() => t.text.withOperators({ then: self => self })).toThrow('Operator "then"')
  })

  it("replace an earlier operator of the same name", () => {
    const caseless = defineType({ sqlType: "text" }).withOperators({
      ...equalityOperators,
      eq: (self, value: string) => sql<boolean>`lower(${self}) = lower(${value})`,
    })
    const account = defineTable("account", {
      email: caseless,
    })

    expect(
      from(account)
        .where(columns => columns.email.eq("A@example.com"))
        .toSQL().text,
    ).toEndWith('WHERE lower("account"."email") = lower($1)')
  })

  it("apply to a SQL fragment of the type", () => {
    expect(
      from(user)
        .where(columns => sql(text)`lower(${columns.name})`.ilike("a%"))
        .toSQL().text,
    ).toEndWith('WHERE (lower("user"."name")) ILIKE $1')
  })
})
