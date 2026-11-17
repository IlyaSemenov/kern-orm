import { describe, expect, it } from "bun:test"

import { describePostgres } from "../../../testing/postgres"
import { bindSchema } from "../../execution/db"
import { from } from "../../query/select"
import { defineSchema } from "../../schema/schema"
import { defineTable } from "../../table/table"
import { defineType } from "../../type/type"
import * as t from "../../types"
import { getType } from "../expression"
import { param, sql } from "../sql"

import { arithmeticOperators } from "./arithmetic"

const item = defineTable("item", {
  price: t.integer,
  quantity: t.integer,
  discount: t.integer,
})

const items = from(item)

it.each([
  ["add", "+"],
  ["sub", "-"],
  ["mul", "*"],
  ["div", "/"],
  ["mod", "%"],
] as const)("%s compiles %s with a parameter that the expression types", (operator, sign) => {
  expect(
    items
      .select(columns => ({
        value: columns.price[operator](2),
      }))
      .toSQL(),
  ).toMatchObject({
    text: `SELECT "item"."price" ${sign} $1 AS "value" FROM "item" AS "item"`,
    parameters: ["2"],
  })
})

it("gives an expression of the type of the expression it is called on", () => {
  expect(getType(sql(t.bigint)`1`.add(2))).toBe(t.bigint)
  const money = t.numeric.with(10, 2)
  expect(getType(sql(money)`1`.add("2.5"))).toBe(money)
})

it("encodes a plain operand with the type of the expression", () => {
  const cents = defineType({ sqlType: "integer" })
    .transform({
      decode: value => Number(value) / 100,
      encode: (value: number) => String(value * 100),
    })
    .withOperators(arithmeticOperators)

  expect(
    items
      .select(() => ({
        value: param(cents, 1).add(2.5),
      }))
      .toSQL().parameters,
  ).toEqual(["100", "250"])
})

it("takes a query of one value as an operand, also of a nested operator", () => {
  const maxPrice = from(item).max("price")

  expect(
    items
      .select(columns => ({
        value: columns.price.add(maxPrice),
        nested: columns.price.mul(columns.quantity.sub(maxPrice)),
      }))
      .toSQL().text,
  ).toBe(
    'SELECT "item"."price" + (SELECT max("item_2"."price") AS "max" FROM "item" AS "item_2") AS "value", "item"."price" * ("item"."quantity" - (SELECT max("item_3"."price") AS "max" FROM "item" AS "item_3")) AS "nested" FROM "item" AS "item"',
  )
})

describe("parentheses", () => {
  it("groups operators of one precedence from the left", () => {
    expect(
      items
        .select(columns => ({
          left: columns.price.sub(columns.discount).sub(1),
          right: columns.price.sub(columns.discount.sub(1)),
          quotient: columns.price.div(columns.quantity.mul(2)),
        }))
        .toSQL().text,
    ).toBe(
      'SELECT "item"."price" - "item"."discount" - $1 AS "left", "item"."price" - ("item"."discount" - $2) AS "right", "item"."price" / ("item"."quantity" * $3) AS "quotient" FROM "item" AS "item"',
    )
  })

  it("keeps a sum in a product and a product in a sum by their precedence", () => {
    expect(
      items
        .select(columns => ({
          product: columns.price.sub(columns.discount).mul(columns.quantity),
          sum: columns.price.mul(columns.quantity).sub(columns.discount.mod(2)),
        }))
        .toSQL().text,
    ).toBe(
      'SELECT ("item"."price" - "item"."discount") * "item"."quantity" AS "product", "item"."price" * "item"."quantity" - "item"."discount" % $1 AS "sum" FROM "item" AS "item"',
    )
  })

  it("puts an interpolated operator in parentheses and not a compared one", () => {
    expect(
      items
        .where(columns => columns.price.add(1).gt(columns.quantity.mul(2)))
        .select(columns => ({
          double: sql(t.integer)`${columns.price.add(1)} * 2`,
        }))
        .toSQL().text,
    ).toBe(
      'SELECT ("item"."price" + $1) * 2 AS "double" FROM "item" AS "item" WHERE "item"."price" + $2 > "item"."quantity" * $3',
    )
  })
})

describePostgres("in PostgreSQL", ({ database, testTransaction, useTestFixture }) => {
  const account = defineTable("account", {
    id: t.integer.primaryKey(),
    visits: t.integer.nullable(),
    total: t.bigint,
    balance: t.numeric,
    rate: t.doublePrecision,
  })

  useTestFixture(() =>
    database.script(`
      CREATE TABLE account (id integer PRIMARY KEY, visits integer, total bigint, balance numeric, rate double precision);
      INSERT INTO account VALUES (1, 7, 9007199254740993, 10.25, 0.5), (2, NULL, 0, 0, 0);
    `),
  )

  const db = bindSchema(defineSchema({ account }), database)
  const accounts = db.account.orderBy("id")

  it("computes in the type of the operands and decodes with the type of the expression", async () => {
    const query = accounts.select(columns => ({
      quotient: columns.visits.div(2),
      remainder: columns.visits.mod(2),
      total: columns.total.add(1),
      balance: columns.balance.mul("1.5"),
      rate: columns.rate.div(4),
    }))

    expect(await testTransaction(async () => await query)).toEqual([
      { quotient: 3, remainder: 1, total: 9007199254740994n, balance: "15.375", rate: 0.125 },
      { quotient: null, remainder: null, total: 1n, balance: "0.0", rate: 0 },
    ])
  })

  it("adds a value to a column in an update", async () => {
    const query = db.account.find(1).update(columns => ({
      visits: columns.visits.add(1),
    }))

    expect(
      await testTransaction(async () => {
        await query
        return await accounts.pluck("visits")
      }),
    ).toEqual([8, null])
  })
})
