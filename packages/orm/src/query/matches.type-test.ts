import { describe, expectTypeOf, test } from "bun:test"

import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"
import { createDatabase } from "kern-db"

import { bindSchema } from "../execution/db"
import { caseWhen } from "../expression/functions"
import { or } from "../expression/predicates"
import { param } from "../expression/sql"
import { many } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { matches } from "./matches"
import { defineExpression } from "./reusable-expression"
import type { ResultOf } from "./select"
import { from } from "./select"

const form = defineTable("form", {
  id: t.uuid.primaryKey(),
  name: t.text,
  published: t.boolean,
  hint: t.text.nullable(),
  settings: t.json.nullable(),
})

const field = defineTable("field", {
  id: t.uuid.primaryKey(),
  formId: t.uuid,
  label: t.text.nullable(),
})

const schema = defineSchema({ form, field }).$relations({
  form: {
    fields: many(field, { from: "id", to: "formId" }),
  },
})

const db = bindSchema(schema, createDatabase({ driver: createRecordingDriver().driver }))

describe("result", () => {
  test("is boolean of columns and values that are never NULL", () => {
    const query = db.form.select(form => ({
      value: matches(form, { name: "Survey", published: true }),
      isNull: matches(form, { hint: null }),
      empty: matches(form, {}),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{
      value: boolean
      isNull: boolean
      empty: boolean
    }>()
  })

  test("includes null of a nullable column, expression, or query", () => {
    const query = db.form.select(form => ({
      column: matches(form, { hint: "Optional" }),
      expression: matches(form, { name: form.hint }),
      query: matches(form, { name: form.fields.take().get("id") }),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{
      column: boolean | null
      expression: boolean | null
      query: boolean | null
    }>()
  })

  test("includes null of a nullable column in one object of a union", () => {
    const values = null! as { hint: string } | { name: string }
    const query = from(form).select(form => ({
      value: matches(form, values),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ value: boolean | null }>()
  })

  test("is the result of a custom eq", () => {
    const custom = defineTable("custom", {
      nullable: t.text.withOperators({
        eq: (_self, _value: string) => param(t.boolean.nullable(), null),
      }),
      required: t.text.withOperators({
        eq: (_self, _value: string) => param(t.boolean, true),
      }),
    })
    const query = from(custom).select(custom => ({
      nullable: matches(custom, { nullable: "x" }),
      required: matches(custom, { required: "x" }),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{
      nullable: boolean | null
      required: boolean
    }>()
  })

  test("combines with expressions in a reusable expression", () => {
    const isListed = defineExpression(db.form, (form, name: string) =>
      or(matches(form, { published: true }), form.name.eq(name)),
    )
    const query = db.form
      .where(form => isListed(form, "Survey"))
      .select(form => ({
        isListed: isListed(form, "Survey"),
        label: caseWhen(t.text, [[isListed(form, "Survey"), "yes"]], "no"),
      }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ isListed: boolean; label: string }>()
  })
})

describe("object of column values", () => {
  test("takes an object with optional values", () => {
    const filters: { name?: string; published?: boolean } = {}

    expectTypeOf(from(form).where(form => matches(form, filters))).not.toBeNever()
  })

  test("rejects a key that is not a column", () => {
    // @ts-expect-error A misspelled key beside a column.
    db.form.where(form => matches(form, { published: true, nmae: "Survey" }))

    // @ts-expect-error A misspelled key alone.
    db.form.where(form => matches(form, { nmae: "Survey" }))

    // @ts-expect-error A relation is not a column.
    db.form.where(form => matches(form, { fields: true }))
  })

  test("rejects a value that is not an operand of the eq of its column", () => {
    // @ts-expect-error The value of a Boolean column.
    db.form.where(form => matches(form, { published: 42 }))

    // @ts-expect-error `null` of a column that is not nullable.
    db.form.where(form => matches(form, { published: null }))

    // @ts-expect-error A JSON column has no `eq` operator, so it matches only `null`.
    from(form).where(form => matches(form, { settings: { theme: "dark" } }))

    from(form).where(form => matches(form, { settings: null }))
  })
})
