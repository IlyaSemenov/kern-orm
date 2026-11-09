import { describe, expectTypeOf, test } from "bun:test"

import { createDatabase } from "../execution/database"
import type { ResultOf } from "../query/select"
import { from } from "../query/select"
import { many, one } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { caseWhen, coalesce, greatest, least } from "./functions"
import { and, or } from "./predicates"
import { param, sql } from "./sql"

const scoreType = t.integer.transform({
  decode: value => ({ value }),
  encode: (score: { value: number }) => score.value,
})

const kindType = t.enum("kind", ["a", "b"])

const form = defineTable("form", {
  id: t.uuid.primaryKey(),
  name: t.text,
  hint: t.text.nullable(),
  position: t.integer,
  limit: t.integer.nullable(),
  size: t.bigint,
  score: scoreType.nullable(),
  publishedAt: t.timestamptz.nullable(),
  settings: t.jsonb,
  kind: kindType.nullable(),
  tags: t.array(t.text).nullable(),
})

const field = defineTable("field", {
  formId: t.uuid,
  label: t.text.nullable(),
  position: t.integer,
})

const schema = defineSchema({ form, field }).$relations({
  form: { fields: many(field, { from: "id", to: "formId" }) },
  field: { form: one(form, { from: "formId", to: "id", required: true }) },
})

describe("the value of a function", () => {
  test("is NULL only when every operand can be", () => {
    const query = from(form).select(form => ({
      value: coalesce(form.limit, 0),
      nullableBeforeColumn: greatest(form.limit, form.position),
      columnBeforeNullable: least(form.position, form.limit),
      nullableColumns: coalesce(form.limit, form.limit),
      nullableColumnAlone: coalesce(form.limit),
      columnAlone: coalesce(form.position),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{
      value: number
      nullableBeforeColumn: number
      columnBeforeNullable: number
      nullableColumns: number | null
      nullableColumnAlone: number | null
      columnAlone: number
    }>()
  })

  test("takes the values that the type of the first operand encodes", () => {
    const query = from(form).select(form => ({
      score: coalesce(form.score, { value: 0 }),
      publishedAt: coalesce(form.publishedAt, new Date()),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{
      score: { value: number }
      publishedAt: string
    }>()
  })

  test("is not NULL after a plain value of a union of literals", () => {
    const query = from(form).select(form => ({
      kind: coalesce(form.kind, "a"),
      largest: greatest(form.kind, "b", "a"),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{
      kind: "a" | "b"
      largest: "a" | "b"
    }>()
  })

  test("may be NULL after a plain array, which a `const` operand cannot be", () => {
    const query = from(form).select(form => ({
      tags: coalesce(form.tags, ["a"]),
      typed: coalesce(form.tags, param(t.array(t.text), ["a"])),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{
      tags: string[] | null
      typed: string[]
    }>()
  })

  test("may be NULL when the following operands are an array, which may be empty", () => {
    const fallbacks: number[] = []
    const query = from(form).select(form => ({
      value: coalesce(form.limit, ...fallbacks),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ value: number | null }>()
  })
})

describe("queries as operands", () => {
  test("an aggregate gives the type of the result, and is NULL without values", () => {
    const query = schema.form.select(form => ({
      value: coalesce(form.fields.max("position"), 0),
      nullable: coalesce(form.fields.max("position")),
      count: greatest(form.fields.count(), form.position),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{
      value: number
      nullable: number | null
      count: number
    }>()
  })

  test("a query is NULL without its row, unless a required relation guarantees it", () => {
    const query = schema.field.select(field => ({
      missing: coalesce(from(form).where({ name: "x" }).take().get("name")),
      guaranteed: coalesce(field.form.get("name")),
      fallback: coalesce(from(form).where({ name: "x" }).take().get("name"), field.label, ""),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{
      missing: string | null
      guaranteed: string
      fallback: string
    }>()
  })

  test("a later query of the values of the first operand is an operand", () => {
    const query = schema.form.select(form => ({
      value: greatest(form.position, form.fields.max("position")),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ value: number }>()
  })
})

describe("the result of a function", () => {
  test("has the operators of the type of the first operand", () => {
    from(form).where(form => coalesce(form.name, "x").like("a%"))
    from(form).where(form => greatest(form.position, form.limit).gt(3))
    schema.form.where(form => coalesce(form.fields.max("position"), 0).gt(3))
    schema.form.where(form => coalesce(form.fields.count(), 0).gt(3))

    // @ts-expect-error `uuid` has no `like`.
    from(form).where(form => coalesce(form.id, "x").like("a%"))
  })

  test("compares with the values that the type of the first operand encodes", () => {
    from(form).where(form => coalesce(form.publishedAt, new Date()).lt(new Date()))

    // @ts-expect-error The type of the first operand takes a number.
    from(form).where(form => coalesce(form.position, 0).gt("3"))
  })

  test("is a condition when its value is Boolean", () => {
    schema.form.where(form =>
      coalesce(
        form.fields.some(field => field.position.gt(1)),
        false,
      ),
    )
  })

  test("sorts and aggregates", () => {
    from(form).orderBy(form => coalesce(form.limit, 0))
    const query = from(form).max(form => coalesce(form.limit, 0))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<number | null>()
  })

  test("nests in another function", () => {
    const query = schema.form.select(form => ({
      value: greatest(coalesce(form.fields.max("position"), 0), coalesce(form.limit, 0)),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ value: number }>()
  })

  test("is the value of a column of an update", () => {
    const db = createDatabase({
      driver: {
        execute: () => Promise.reject(new Error("unused")),
        executeScript: () => Promise.reject(new Error("unused")),
        acquire: () => Promise.reject(new Error("unused")),
        close: () => Promise.resolve(),
      },
    }).bind(schema)

    db.form.where({ name: "x" }).update(form => ({
      position: coalesce(form.limit, 0),
    }))
  })
})

describe("rejected operands", () => {
  test("the first operand has a type", () => {
    // @ts-expect-error A plain value has no type to decode the result.
    coalesce(0, 1)
    // @ts-expect-error A fragment without a type does not decode the result.
    coalesce(sql<number>`1`, 1)

    coalesce(sql(t.integer)`1`, sql<number>`1`)
  })

  test("the following operands have the values of the first operand", () => {
    // @ts-expect-error The type of the first operand takes a number.
    from(form).select(form => ({ value: coalesce(form.limit, "0") }))
    // @ts-expect-error The first operand has number values.
    from(form).select(form => ({ value: greatest(form.position, form.name) }))
    // @ts-expect-error A `bigint` has other values than a `number`.
    from(form).select(form => ({ value: greatest(form.position, form.size) }))
    // @ts-expect-error A plain `null` has no effect.
    from(form).select(form => ({ value: coalesce(form.limit, null) }))
    // @ts-expect-error A plain `undefined` has no value.
    from(form).select(form => ({ value: coalesce(form.limit, undefined) }))
  })

  test("a query is of one value", () => {
    // @ts-expect-error A query of rows `many` has no value.
    coalesce(from(form).pluck("position"), 0)
    // @ts-expect-error A query of records has no value.
    coalesce(from(form).select("position").take(), 0)
    // @ts-expect-error A query of rows `many` has no value.
    from(form).select(form => ({ value: coalesce(form.limit, from(form).pluck("position")) }))
  })
})

describe("caseWhen", () => {
  test("is NULL when no branch holds, unless it has a fallback", () => {
    const query = from(form).select(form => ({
      fallback: caseWhen(t.integer, [[form.name.eq("x"), 1]], 0),
      noFallback: caseWhen(t.integer, [[form.name.eq("x"), 1]]),
      noBranches: caseWhen(t.integer, []),
      onlyFallback: caseWhen(t.integer, [], 0),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{
      fallback: number
      noFallback: number | null
      noBranches: number | null
      onlyFallback: number
    }>()
  })

  test("is NULL when the value of a branch or of the fallback can be", () => {
    const query = from(form).select(form => ({
      nullBranch: caseWhen(t.integer, [[form.name.eq("x"), null]], 0),
      nullFallback: caseWhen(t.integer, [[form.name.eq("x"), 1]], null),
      nullableBranch: caseWhen(t.integer, [[form.name.eq("x"), form.limit]], 0),
      nullableFallback: caseWhen(t.integer, [[form.name.eq("x"), 1]], form.limit),
      nullableQuery: caseWhen(t.integer, [[form.name.eq("x"), from(field).max("position")]], 0),
      everyValue: caseWhen(
        t.integer,
        [
          [form.name.eq("x"), 1],
          [form.name.eq("y"), form.position],
        ],
        form.position,
      ),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{
      nullBranch: number | null
      nullFallback: number | null
      nullableBranch: number | null
      nullableFallback: number | null
      nullableQuery: number | null
      everyValue: number
    }>()
  })

  test("reads the values of its branches rather than whether the type is nullable", () => {
    const query = from(form).select(form => ({
      value: caseWhen(t.integer.nullable(), [[form.name.eq("x"), 1]], 0),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ value: number }>()
  })

  test("takes the values that its type encodes and decodes", () => {
    const query = from(form).select(form => ({
      score: caseWhen(scoreType, [[form.name.eq("x"), { value: 1 }]], form.score),
      date: caseWhen(t.timestamptz, [[form.name.eq("x"), new Date()]], "2026-01-01T00:00:00Z"),
      kind: caseWhen(kindType, [[form.name.eq("x"), "a"]], "b"),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{
      score: { value: number } | null
      date: string
      kind: "a" | "b"
    }>()
  })

  test("takes branches built in code", () => {
    const weights = [{ name: "x", weight: 1 }]
    from(form).select(form => ({
      value: caseWhen(
        t.integer,
        weights.map(({ name, weight }) => [form.name.eq(name), weight] as const),
        0,
      ),
    }))
  })

  test("has the operators of its type", () => {
    from(form).where(form => caseWhen(t.integer, [[form.name.eq("x"), 1]], 0).gt(0))
    from(form).where(form => caseWhen(t.text, [[form.name.eq("x"), "a"]], "b").like("a%"))

    // @ts-expect-error `integer` has no `like`.
    from(form).where(form => caseWhen(t.integer, [[form.name.eq("x"), 1]], 0).like("a%"))
    // @ts-expect-error `integer` takes a number.
    from(form).where(form => caseWhen(t.integer, [[form.name.eq("x"), 1]], 0).gt("0"))
  })

  test("takes a Boolean expression and a query of one Boolean value as a condition", () => {
    schema.form.select(form => ({
      exists: caseWhen(t.integer, [[form.fields.exists(), 1]], 0),
      aggregate: caseWhen(t.integer, [[form.fields.some(field => field.position.gt(1)), 1]], 0),
      value: caseWhen(t.integer, [[from(field).take().get("position").expr().gt(1), 1]], 0),
      combined: caseWhen(t.integer, [[and(form.name.eq("x"), or(form.name.eq("y"))), 1]], 0),
      fragment: caseWhen(t.integer, [[sql<boolean>`TRUE`, 1]], 0),
    }))
  })

  test("is a condition, a sort key, an aggregate argument, and an operand of a function", () => {
    from(form).where(form => caseWhen(t.boolean, [[form.name.eq("x"), true]], false))
    from(form).orderBy(form => caseWhen(t.integer, [[form.name.eq("x"), 1]], 0))
    const aggregated = from(form).max(form => caseWhen(t.integer, [[form.name.eq("x"), 1]], 0))
    const query = schema.form.select(form => ({
      value: greatest(
        coalesce(
          form.fields.max(field =>
            caseWhen(
              t.integer,
              [
                [field.label.eq("owner"), 100],
                [field.label.eq("editor"), 50],
              ],
              0,
            ),
          ),
          0,
        ),
        coalesce(form.limit, 0),
      ),
    }))

    expectTypeOf<ResultOf<typeof aggregated>>().toEqualTypeOf<number | null>()
    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ value: number }>()
  })

  test("rejects arguments outside its contract", () => {
    // @ts-expect-error A column is not a type.
    from(form).select(form => ({ value: caseWhen(form.position, [], 0) }))
    // @ts-expect-error The value of a branch has the values of the type.
    from(form).select(form => ({ value: caseWhen(t.integer, [[form.name.eq("x"), "1"]], 0) }))
    // @ts-expect-error The fallback has the values of the type.
    from(form).select(form => ({ value: caseWhen(t.integer, [[form.name.eq("x"), 1]], "0") }))
    // @ts-expect-error An expression has the values of the type.
    from(form).select(form => ({ value: caseWhen(t.integer, [[form.name.eq("x"), form.name]]) }))
    // @ts-expect-error A condition is Boolean.
    from(form).select(form => ({ value: caseWhen(t.integer, [[form.name, 1]], 0) }))
    // @ts-expect-error A plain Boolean value is not a condition.
    from(form).select(() => ({ value: caseWhen(t.integer, [[true, 1]], 0) }))
    // @ts-expect-error An object of column values has no table here.
    from(form).select(() => ({ value: caseWhen(t.integer, [[{ name: "x" }, 1]], 0) }))
    const positions = from(field).pluck("position")
    // @ts-expect-error A query of many rows is not a value.
    from(form).select(() => ({ value: caseWhen(t.integer, [[and(), positions]]) }))

    const maybe = undefined as number | undefined
    // @ts-expect-error A fallback that may be missing would make the result NULL silently.
    from(form).select(form => ({ value: caseWhen(t.integer, [[form.name.eq("x"), 1]], maybe) }))
  })
})
