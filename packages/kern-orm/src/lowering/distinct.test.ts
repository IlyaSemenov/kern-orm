import { describe, expect, it } from "bun:test"

import { compileStatement } from "../compiler/postgres/compile"
import type { AnyExpression } from "../expression/expression"
import { sql } from "../expression/sql"
import { literal } from "../query/literal"
import { desc } from "../query/order"
import type { AnySelectQuery } from "../query/select"
import { many, one } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { lowerQuery, lowerStatement } from "./lower"

const form = defineTable("form", {
  id: t.integer.primaryKey(),
})

const field = defineTable("form_field", {
  id: t.integer,
  formId: t.integer,
  label: t.text,
})

const option = defineTable("field_option", {
  fieldId: t.integer,
})

const forms = defineSchema({ form, field }).$relations({
  form: {
    fields: many(field, { from: "id", to: "formId" }),
  },
  field: {
    form: one(form, { from: "formId", to: "id", required: true }),
  },
})

const schema = defineSchema(forms, { option }).$relations({
  field: {
    options: many(option, { from: "id", to: "fieldId" }),
  },
})

describe("query of distinct", () => {
  it("rejects a query without fields that SQL selects, which PostgreSQL has no syntax for", () => {
    const message =
      "distinct requires at least one selected column or SQL expression; literal fields are not compared"

    for (const { node } of [
      schema.form.distinct(),
      schema.form.select("id").distinct().clearSelect(),
      schema.form
        .select(() => ({
          kind: literal("form"),
        }))
        .distinct(),
    ]) {
      expect(() => lowerStatement(node)).toThrow(message)
      expect(() => lowerQuery(node)).toThrow(message)
    }
  })

  it("rejects nested rows, which are JSON, at any depth, also of a converted aggregate", () => {
    const message = (key: string) =>
      `distinct cannot compare the nested rows of the selected field "${key}"`

    expect(() =>
      lowerStatement(
        schema.form
          .select(form => ({
            labels: form.fields.pluck("label"),
          }))
          .distinct().node,
      ),
    ).toThrow(message("labels"))
    expect(() =>
      lowerStatement(
        schema.form
          .select(form => ({
            fieldCount: form.fields.count().map(String),
          }))
          .distinct().node,
      ),
    ).toThrow(message("fieldCount"))
    expect(() =>
      lowerStatement(
        schema.form.select(form => ({
          fields: form.fields
            .select(field => ({
              values: field.options.pluck("fieldId"),
            }))
            .distinct(),
        })).node,
      ),
    ).toThrow(message("values"))
  })

  it("rejects a sort key that it does not select, also when nested, where packing would compare it too", () => {
    const message =
      "A query of distinct sorts only by its selected fields, since duplicates can differ in any other value; select the value to sort by it"
    const labels = schema.field.pluck("label").distinct()
    const upper = schema.field.pluck(field => sql(t.text)`upper(${field.label})`).distinct()

    expect(() => lowerStatement(labels.orderBy("id").node)).toThrow(message)
    // Only the same node is sure to have the value of the sort expression.
    expect(() =>
      lowerStatement(upper.orderBy(field => sql(t.text)`upper(${field.label})`).node),
    ).toThrow(message)
    expect(() =>
      lowerStatement(
        schema.form.select(form => ({
          labels: form.fields.pluck("label").distinct().orderBy("id"),
        })).node,
      ),
    ).toThrow(message)
    expect(() =>
      lowerStatement(
        schema.form.where(form => form.id.in(schema.field.pluck("id").distinct().orderBy("label")))
          .node,
      ),
    ).toThrow(message)
  })
})

describe("query of distinctOn", () => {
  const compile = (query: AnySelectQuery) => compileStatement(lowerStatement(query.node)).text
  const message =
    "A query of distinctOn must sort by all its keys before any other value; sort by a key of an expression through its selected field"
  const keyed = schema.field.distinctOn("formId", "label").select("id")
  const bucket = (field: { id: AnyExpression<number> }) => sql(t.integer)`${field.id} % ${3}`
  const buckets = schema.field
    .select(field => ({
      bucket: bucket(field),
      id: field.id,
    }))
    .distinctOn((_field, selected) => selected.bucket)
    .orderBy((field, selected) => [selected.bucket, desc(field.id)])

  it("takes an order that sorts by all its keys first, in any order and direction, an order of only some keys, or none", () => {
    expect(compile(keyed.orderBy({ label: "desc" }, "formId", "id", "label"))).toBe(
      'SELECT DISTINCT ON ("form_field"."formId", "form_field"."label") "form_field"."id" AS "id" FROM "form_field" AS "form_field" ORDER BY "form_field"."label" DESC, "form_field"."formId", 1, "form_field"."label"',
    )
    expect(compile(keyed.orderBy("formId"))).toEndWith('ORDER BY "form_field"."formId"')
    expect(compile(keyed)).toBe(
      'SELECT DISTINCT ON ("form_field"."formId", "form_field"."label") "form_field"."id" AS "id" FROM "form_field" AS "form_field"',
    )
  })

  it("rejects an order that sorts by another value before all its keys, wherever the query is", () => {
    for (const order of [["id", "formId", "label"] as const, ["formId", "id"] as const]) {
      const query = keyed.orderBy(...order)
      expect(() => lowerStatement(query.node)).toThrow(message)
      expect(() => lowerQuery(query.node)).toThrow(message)
      expect(() =>
        lowerStatement(
          schema.form.select(form => ({
            fields: form.fields
              .distinctOn("formId", "label")
              .select("id")
              .orderBy(...order),
          })).node,
        ),
      ).toThrow(message)
      expect(() =>
        lowerStatement(schema.form.where(form => form.id.in(query.pluck("id"))).node),
      ).toThrow(message)
    }
    // Only the same node is sure to have the value of the key.
    expect(() =>
      lowerStatement(
        schema.field
          .select("id")
          .distinctOn(field => sql(t.text)`upper(${field.label})`)
          .orderBy(field => [sql(t.text)`upper(${field.label})`, field.id]).node,
      ),
    ).toThrow(message)
  })

  it("compiles a key of a selected expression with parameters and its sort key as the position of its projection, also as a subquery, and rejects them once the query no longer selects it, whose copies would have parameters of their own", () => {
    const text =
      'SELECT DISTINCT ON (1) "form_field"."id" % $1 AS "bucket", "form_field"."id" AS "id" FROM "form_field" AS "form_field" ORDER BY 1, 2 DESC'

    expect(compile(buckets)).toBe(text)
    expect(compile(schema.form.where(form => sql<boolean>`${form.id} IN ${buckets}`))).toBe(
      `SELECT FROM "form" AS "form" WHERE "form"."id" IN (${text})`,
    )
    for (const query of [
      buckets.clearSelect().select("id"),
      buckets.select(field => ({
        bucket: bucket(field),
      })),
    ]) {
      expect(() => lowerStatement(query.node)).toThrow(message)
      expect(() => lowerStatement(schema.$select({ rows: query }).node)).toThrow(message)
      expect(() =>
        lowerStatement(schema.form.where(form => form.id.in(query.pluck("id"))).node),
      ).toThrow(message)
    }
  })

  it("rejects a query without fields that SQL selects, which PostgreSQL has no syntax for", () => {
    const expected =
      "distinctOn requires at least one selected column or SQL expression; literal fields are not selected"

    for (const { node } of [
      schema.field.distinctOn("formId"),
      schema.field
        .select(() => ({
          kind: literal("field"),
        }))
        .distinctOn("formId"),
    ]) {
      expect(() => lowerStatement(node)).toThrow(expected)
      expect(() => lowerQuery(node)).toThrow(expected)
    }
  })
})
