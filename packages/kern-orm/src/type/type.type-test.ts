import { describe, test } from "bun:test"

import { param, sql } from "../expression/sql"
import { from } from "../query/select"
import type { Selectable } from "../table/table"
import { defineTable } from "../table/table"
import * as t from "../types"

describe("transform", () => {
  const price = defineTable("price", {
    amount: t.numeric.with(10, 2).transform({ decode: Number }),
    discount: t.numeric.with(10, 2).nullable().transform({ decode: Number }),
    at: t.timestamptz.transform({ decode: value => new Date(value) }),
  })

  test("changes the values of selected rows", () => {
    const row: Selectable<typeof price> = { amount: 12.5, discount: null, at: new Date() }
    void row

    // @ts-expect-error A transformed column has the new representation.
    const amount: Selectable<typeof price>["amount"] = "12.50"
    void amount
  })

  test("keeps the operators of the original type", () => {
    from(price).where(columns => columns.amount.lt(10))
    from(price).where(columns => columns.at.gt(new Date()))
  })

  test("passes non-null values to `decode`", () => {
    // @ts-expect-error `decode` receives non-null values of the column type.
    t.text.nullable().transform({ decode: (value: number) => value })
  })

  test("without `encode` accepts the values of the original type", () => {
    // @ts-expect-error Without `encode`, a transformed type accepts the values of the original type.
    t.text.transform<number, number>({ decode: Number })

    const length = t.text.transform({ decode: value => value.length })
    // @ts-expect-error Without `encode`, compared values stay those of the original type.
    sql(length)`length(name)`.eq(3)
    sql(length)`name`.eq("abc")
  })
})

describe("with", () => {
  test("is available on a type with PostgreSQL type parameters", () => {
    t.varchar.with(10)

    // @ts-expect-error Only a type with PostgreSQL type parameters has `with`.
    t.text.with(10)
  })

  test("takes parameters typed by the type", () => {
    // @ts-expect-error Type parameters are typed by the type.
    t.varchar.with("10")
  })
})

describe("selected values", () => {
  const message = defineTable("message", {
    code: t.varchar.with(10),
    body: t.varchar,
    meta: t.jsonb.of<{ tags: string[] }>(),
    extra: t.jsonb,
  })

  test("are typed by the column types", () => {
    const row: Selectable<typeof message> = {
      code: "a",
      body: "b",
      meta: { tags: [] },
      extra: 1,
    }
    void row
  })

  test("of `jsonb` are typed by a declared JSON shape", () => {
    // @ts-expect-error A declared JSON shape types the values.
    const meta: Selectable<typeof message>["meta"] = { tags: "a" }
    void meta
  })
})

describe("sql and param", () => {
  test("take a type", () => {
    sql(t.timestamptz)`now()`.gt(new Date())
    param(t.bigint, 1).eq(1)
  })

  test("reject a column", () => {
    // @ts-expect-error A column is not a type.
    sql(t.uuid.primaryKey())

    // @ts-expect-error A column is not a type.
    param(t.uuid.columnName("account_id"), "id")
  })
})

describe("primaryKey", () => {
  test("rejects a nullable column", () => {
    // @ts-expect-error A primary key column is not nullable.
    t.uuid.nullable().primaryKey()

    // @ts-expect-error A primary key column is not nullable.
    t.uuid.nullable().columnName("account_id").primaryKey()
  })
})
