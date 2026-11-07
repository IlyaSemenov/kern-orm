import { describe, expectTypeOf, test } from "bun:test"

import type { ResultOf } from "../query/select"
import { from } from "../query/select"
import { many } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { avg, count, countDistinct, every, max, min, some, sum } from "./aggregates"
import { caseWhen, coalesce } from "./functions"
import { sql } from "./sql"

const scoreType = t.integer.transform({
  decode: value => ({ value }),
  encode: (score: { value: number }) => score.value,
})

const form = defineTable("form", {
  id: t.uuid.primaryKey(),
  name: t.text,
})

const field = defineTable("field", {
  id: t.uuid.primaryKey(),
  formId: t.uuid,
  position: t.integer,
  label: t.text.nullable(),
  required: t.boolean,
  size: t.bigint,
  score: scoreType,
})

const schema = defineSchema({ form, field }).$relations({
  form: { fields: many(field, { from: "id", to: "formId" }) },
})

describe("the value of an aggregate function", () => {
  test("is a number of a count, and the value of the argument or null of another aggregate", () => {
    const query = from(field).select(field => ({
      total: count(),
      labelled: count(field.label),
      labels: countDistinct(field.label),
      first: min(field.position),
      last: max(field.label),
      positions: sum(field.position),
      sizes: sum(field.size),
      average: avg(field.position),
      allRequired: every(field.required),
      anyRequired: some(field.required),
      bestScore: max(field.score),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{
      total: number
      labelled: number
      labels: number
      first: number | null
      last: string | null
      positions: number | null
      sizes: bigint | null
      average: number | null
      allRequired: boolean | null
      anyRequired: boolean | null
      bestScore: { value: number } | null
    }>()
  })

  test("of a query of one value is the value of the query or null", () => {
    const query = schema.form.select(form => ({
      most: max(form.fields.count()),
      labels: count(form.fields.max("label")),
      longest: max(form.fields.max(field => field.label.length())),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{
      most: number | null
      labels: number
      longest: number | null
    }>()
  })

  test("removes null with coalesce", () => {
    const query = from(field).select(field => ({
      positions: coalesce(sum(field.position), 0),
      last: coalesce(max(field.label), field.label),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{
      positions: number
      last: string | null
    }>()
  })
})

describe("the expression of an aggregate function", () => {
  test("has the operators of its type", () => {
    from(field).select(field => ({
      positive: sum(field.position).gt(0),
      several: count().gt(1),
      text: max(field.label).like("a%"),
      missing: max(field.position).isNull(),
    }))

    from(field).select(field => ({
      // @ts-expect-error `integer` has no `like`.
      text: max(field.position).like("a%"),
    }))
    from(field).select(field => ({
      // @ts-expect-error `integer` takes a number.
      positive: sum(field.position).gt("0"),
    }))
    from(field).select(() => ({
      // @ts-expect-error A count takes a number.
      several: count().gt("1"),
    }))
  })

  test("is a selected field, a sort key by its value, and a value of caseWhen and of its condition", () => {
    const query = from(field)
      .select(field => ({
        total: count(),
        size: caseWhen(t.text, [[count().gt(10), "large"]], "small"),
        last: caseWhen(t.integer, [[count().gt(1), max(field.position)]], 0),
      }))
      .orderBy((_field, selected) => selected.total)

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{
      total: number
      size: string
      last: number | null
    }>()
  })
})

describe("the argument of an aggregate function", () => {
  test("is an expression with a type or a query of one value", () => {
    from(field).select(field => ({
      fragment: max(sql(t.integer)`${field.position} + 1`),
    }))

    // @ts-expect-error A plain value has no type to decode the value.
    max(1)
    // @ts-expect-error A column key is not an expression.
    max("position")
    // @ts-expect-error A fragment without a type does not decode the value.
    max(sql<number>`1`)
    // @ts-expect-error A fragment without a type does not decode the value.
    count(sql<number>`1`)
    // @ts-expect-error A fragment without a type does not decode the value.
    countDistinct(sql<number>`1`)
    // @ts-expect-error A query of rows `many` has no value.
    max(from(field).pluck("position"))
    // @ts-expect-error A query of records has no value.
    max(from(field).select("position").take())
    // @ts-expect-error `undefined` would count the rows silently.
    count(undefined)
    // @ts-expect-error countDistinct takes a value to compare.
    countDistinct()
    // @ts-expect-error max takes a value.
    max()
  })
})
