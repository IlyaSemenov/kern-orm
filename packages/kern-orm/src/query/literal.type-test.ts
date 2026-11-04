import { describe, expectTypeOf, test } from "bun:test"

import { many } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { literal } from "./literal"
import type { ResultOf } from "./select"
import { from } from "./select"

const form = defineTable("form", {
  id: t.integer.primaryKey(),
  status: t.jsonb.of<"draft" | "published">(),
})

const field = defineTable("field", {
  id: t.integer.primaryKey(),
  formId: t.integer,
})

const schema = defineSchema({ form, field }).$relations({
  form: {
    fields: many(field, { from: "id", to: "formId" }),
  },
})

const flag = Boolean(process.env.FLAG)

describe("value", () => {
  test("keeps a literal type of a primitive and leaves objects and arrays mutable", () => {
    expectTypeOf(literal("none").literal).toEqualTypeOf<"none">()
    expectTypeOf(literal(1).literal).toEqualTypeOf<1>()
    expectTypeOf(literal(null).literal).toEqualTypeOf<null>()
    expectTypeOf(literal(undefined).literal).toEqualTypeOf<undefined>()
    expectTypeOf(literal({ a: 1 }).literal).toEqualTypeOf<{ a: number }>()
    expectTypeOf(literal([1, 2]).literal).toEqualTypeOf<number[]>()
  })

  test("takes a value of any type", () => {
    const value = {} as unknown
    const anything = {} as any

    expectTypeOf(literal(value).literal).toEqualTypeOf<unknown>()
    expectTypeOf(literal(anything).literal).toBeAny()
  })
})

describe("selection", () => {
  test("types a field by the value", () => {
    const query = from(form).select(() => ({
      note: literal("none"),
      map: literal(new Map<string, number>()),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{
      note: "none"
      map: Map<string, number>
    }>()
  })

  test("types a field of a branch by the union of its values", () => {
    const query = from(form).select(columns => ({
      status: flag ? columns.status : literal("unknown"),
      id: flag ? columns.id : literal(null),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{
      status: "draft" | "published" | "unknown"
      id: number | null
    }>()
  })

  test("types a branch of a nested query", () => {
    const query = schema.form.select(columns => ({
      fields: flag ? columns.fields.select("id") : literal([]),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ fields: { id: number }[] | never[] }>()
  })

  test("keeps fields when a later selection replaces them", () => {
    const query = from(form)
      .select(() => ({
        id: literal("none"),
      }))
      .select("id")

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ id: number }>()
  })
})

describe("beyond a selection", () => {
  test("rejects a literal where an expression is taken", () => {
    // @ts-expect-error A literal is not a value of a column.
    from(form).where({ id: literal(1) })
    // @ts-expect-error A literal is not an operand.
    from(form).where(columns => columns.id.eq(literal(1)))
    // @ts-expect-error A literal is not the value of a query.
    from(form).get(() => literal(1))
    // @ts-expect-error A literal is not the value of a query.
    from(form).pluck(() => literal(1))
    // @ts-expect-error A literal is not a condition.
    from(form).where(() => literal(true))
    // @ts-expect-error A literal is not a sort key.
    from(form).orderBy(() => literal(1))
  })
})
