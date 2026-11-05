import { expect, it } from "bun:test"

import { describePostgres } from "../../../testing/postgres"
import { from } from "../../query/select"
import { defineSchema } from "../../schema/schema"
import { defineTable } from "../../table/table"
import { defineType } from "../../type/type"
import * as t from "../../types"
import type { AnyExpression } from "../expression"
import { getType } from "../expression"
import { param, sql } from "../sql"

import { defineGenericOperator } from "./generic"
import type { PatternSignature } from "./text"
import { textOperators } from "./text"

const user = defineTable("user", {
  name: t.text,
})

const prefix = "prefix:"
// Text whose encoding differs from the pattern, which is sent as it is.
const encodedText = defineType({ sqlType: "text" }).transform({
  decode: value => value.slice(prefix.length),
  encode: (value: string) => prefix + value,
})

it.each(["like", "ilike"] as const)(
  "%s sends a string pattern as it is and a pattern parameter with its type",
  operator => {
    const name = param(encodedText.withOperators(textOperators), "a")

    expect(from(user).where(name[operator]("a%")).toSQL().parameters).toEqual(["prefix:a", "a%"])
    expect(
      from(user)
        .where(name[operator](param(encodedText, "a%")))
        .toSQL().parameters,
    ).toEqual(["prefix:a", "prefix:a%"])
  },
)

it.each(["lower", "upper"] as const)(
  "%s calls the function and gives an expression of text, whatever the type it is called on",
  operator => {
    const name = sql(encodedText.withOperators(textOperators))`name`

    expect(from(user).where(name[operator]().eq("a")).toSQL()).toMatchObject({
      text: `SELECT FROM "user" AS "user" WHERE (${operator}(name)) = $1`,
      parameters: ["a"],
    })
    expect(getType(name[operator]())).toBe(t.text)
    expect(getType(sql(t.varchar.with(10))`name`[operator]())).toBe(t.text)
  },
)

it("trim calls btrim and gives an expression of text, whatever the type it is called on", () => {
  const name = sql(encodedText.withOperators(textOperators))`name`

  expect(from(user).where(name.trim().eq("a")).toSQL()).toMatchObject({
    text: 'SELECT FROM "user" AS "user" WHERE (btrim(name)) = $1',
    parameters: ["a"],
  })
  expect(getType(name.trim())).toBe(t.text)
})

it("length calls the function and gives an expression of integer, whatever the type it is called on", () => {
  const name = sql(encodedText.withOperators(textOperators))`name`

  expect(from(user).where(name.length().gt(1)).toSQL()).toMatchObject({
    text: 'SELECT FROM "user" AS "user" WHERE (length(name)) > $1',
    parameters: ["1"],
  })
  expect(getType(name.length())).toBe(t.integer)
})

it("a custom pattern operator sends a string pattern as it is", () => {
  const similarTo = defineGenericOperator<PatternSignature, AnyExpression<string | null>>(
    (self, pattern) => sql(t.boolean)`${self} SIMILAR TO ${pattern}`,
  )
  const name = param(encodedText.withOperators({ similarTo }), "a")

  expect(from(user).where(name.similarTo("a%")).toSQL()).toMatchObject({
    text: 'SELECT FROM "user" AS "user" WHERE ($1::text) SIMILAR TO $2',
    parameters: ["prefix:a", "a%"],
  })
})

describePostgres("in PostgreSQL", ({ database, testTransaction, useTestFixture }) => {
  const account = defineTable("account", {
    id: t.integer.primaryKey(),
    name: encodedText.withOperators(textOperators).nullable(),
  })

  useTestFixture(() =>
    database.script(`
      CREATE TABLE account (id integer PRIMARY KEY, name text);
      INSERT INTO account VALUES (1, 'prefix:Ann'), (2, NULL);
    `),
  )

  const accounts = database.bind(defineSchema({ account })).account.orderBy("id")

  it("reads the converted text without the decoder of the type, and NULL as null", async () => {
    const query = accounts.select(columns => ({
      lower: columns.name.lower(),
      upper: columns.name.upper(),
      length: columns.name.length(),
    }))

    expect(await testTransaction(async () => await query)).toEqual([
      { lower: "prefix:ann", upper: "PREFIX:ANN", length: 10 },
      { lower: null, upper: null, length: null },
    ])
  })

  it("removes spaces from both ends of text and keeps others", async () => {
    const query = accounts.take().select(() => ({
      text: param(t.text, "  a b\t ").trim(),
      varchar: param(t.varchar, " a ").trim(),
      char: param(t.char.with(3), " a ").trim(),
    }))

    expect(await testTransaction(async () => await query)).toEqual({
      text: "a b\t",
      varchar: "a",
      char: "a",
    })
  })

  it("counts the characters of varchar, and of char without its trailing spaces", async () => {
    const query = accounts.take().select(() => ({
      varchar: param(t.varchar, "äb").length(),
      char: param(t.char.with(3), "a  ").length(),
    }))

    expect(await testTransaction(async () => await query)).toEqual({ varchar: 2, char: 1 })
  })

  it("gives an expression with the operators of text", async () => {
    const query = accounts
      .where(columns => columns.name.upper().like("PREFIX:%"))
      .where(columns => columns.name.length().gt(1))
      .orderBy(columns => columns.name.lower())
      .pluck(columns => columns.name.upper().lower())

    expect(await testTransaction(async () => await query)).toEqual(["prefix:ann"])
  })
})
