import { expect, it } from "bun:test"

import { compileStatement } from "../compiler/postgres/compile"
import { not } from "../expression/predicates"
import { countType } from "../query/aggregate"
import type { NestedField } from "../result/result"
import { many, one } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { lowerQuery } from "./lower"

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

it("selects EXISTS of a nested query of exists in place of its field, decoded as a Boolean", () => {
  const { node } = schema.form.select(form => ({
    hasFields: form.fields.exists(),
    empty: not(form.fields.exists()),
  }))
  const statement = lowerQuery(node)

  expect(statement.projections).toMatchObject([
    { key: "hasFields", expression: { kind: "exists" }, type: t.boolean },
    { key: "empty", expression: { kind: "not", operand: { kind: "exists" } } },
  ])
  expect(compileStatement(statement).text).toBe(
    'SELECT EXISTS (SELECT FROM "form_field" AS "form_field" WHERE "form_field"."formId" = "form"."id") AS "hasFields", NOT EXISTS (SELECT FROM "form_field" AS "form_field_2" WHERE "form_field_2"."formId" = "form"."id") AS "empty" FROM "form" AS "form"',
  )
})

it("selects the packed rows of a nested query, decoded by its result plan, in place of its field", () => {
  const { node } = schema.form.select(form => ({
    fields: form.fields.pluck("label"),
    id: form.id,
  }))
  const [fields, id] = lowerQuery(node).projections

  expect(fields).toMatchObject({ key: "fields", expression: { kind: "subquery" } })
  expect((fields as NestedField).nested).toMatchObject({ rows: "many", value: true })
  expect<unknown>(id).toBe(node.projections[1])
})

it("selects the value of a nested aggregate query as a scalar subquery, decoded by the type of the aggregate", () => {
  const { node } = schema.form.select(form => ({
    fieldCount: form.fields.count(),
    firstCount: form.fields.limit(3).count().optional(),
    lastLabel: form.fields.max("label"),
  }))
  const statement = lowerQuery(node)

  expect(statement.projections).toMatchObject([
    { key: "fieldCount", expression: { kind: "subquery" }, type: countType },
    { key: "firstCount", expression: { kind: "subquery" }, type: countType },
    { key: "lastLabel", expression: { kind: "subquery" }, type: t.text },
  ])
  expect(compileStatement(statement).text).toBe(
    'SELECT (SELECT count(*) AS "count" FROM "form_field" AS "form_field" WHERE "form_field"."formId" = "form"."id") AS "fieldCount", (SELECT count(*) AS "count" FROM (SELECT FROM "form_field" AS "form_field_2" WHERE "form_field_2"."formId" = "form"."id" LIMIT $1) AS "subquery") AS "firstCount", (SELECT max("form_field_3"."label") AS "max" FROM "form_field" AS "form_field_3" WHERE "form_field_3"."formId" = "form"."id") AS "lastLabel" FROM "form" AS "form"',
  )
})

it("packs a nested aggregate query and a query of exists that code converts, whose result plan holds the conversion", () => {
  const { node } = schema.form.select(form => ({
    fieldCount: form.fields.count().map(String),
    hasFields: form.fields.exists().transform(String),
  }))
  const statement = lowerQuery(node)

  expect(statement.projections).toMatchObject([
    {
      key: "fieldCount",
      expression: { kind: "subquery" },
      nested: { rows: "one", value: true, conversion: { map: expect.any(Function) } },
    },
    {
      key: "hasFields",
      expression: { kind: "subquery" },
      nested: { rows: "one", value: true, conversion: { transform: expect.any(Function) } },
    },
  ])
  expect(compileStatement(statement).text).toBe(
    'SELECT (SELECT json_build_array(CASE WHEN "subquery"."count" IS NOT DISTINCT FROM NULL THEN NULL ELSE format(\'%s\', "subquery"."count") END) AS "rows" FROM (SELECT count(*) AS "count" FROM "form_field" AS "form_field" WHERE "form_field"."formId" = "form"."id" OFFSET 0) AS "subquery") AS "fieldCount", (SELECT json_build_array(CASE WHEN "subquery_2"."exists" IS NOT DISTINCT FROM NULL THEN NULL ELSE format(\'%s\', "subquery_2"."exists") END) AS "rows" FROM (SELECT EXISTS (SELECT FROM "form_field" AS "form_field_2" WHERE "form_field_2"."formId" = "form"."id") AS "exists" OFFSET 0) AS "subquery_2") AS "hasFields" FROM "form" AS "form"',
  )
})
