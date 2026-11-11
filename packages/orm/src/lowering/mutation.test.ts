import { expect, it } from "bun:test"

import { createRecordingDriver } from "../../testing/database/recording-driver"
import { compileStatement } from "../compiler/postgres/compile"
import { createDatabase } from "../database/database"
import { bindSchema } from "../execution/db"
import { and, not } from "../expression/predicates"
import { sql } from "../expression/sql"
import { collectDefinitions, many, one } from "../schema/relation"
import { defineSchema, schemaRelations } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { lowerStatement } from "./lower"

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

it("lowers a mutation to its statement, packing the nested queries of its returned fields", () => {
  const counted = schema.field.where({ formId: 1 }).delete()
  const { node } = counted.select("id").select(field => ({
    options: field.options,
  }))
  const statement = lowerStatement(node)

  expect<unknown>(lowerStatement(counted.node)).toBe(counted.node)
  expect(statement).toMatchObject({ kind: "delete", rows: "many" })
  expect(statement.kind === "delete" && statement.returning).toMatchObject([
    node.returning![0]!,
    { key: "options", nested: { rows: "many", value: false } },
  ])
})

it("replaces the queries in the filters, the values, and the returned fields of a mutation, and in the values of DO UPDATE", () => {
  const hasForms = sql(t.integer)`CASE WHEN ${and(schema.form.exists())} THEN 1 ELSE 0 END`
  const remove = schema.form.where(form => not(form.fields.exists())).delete()
  const update = schema.field.where({ id: 1 }).update({ formId: hasForms })
  const insert = schema.option
    .insert({ fieldId: hasForms })
    .onConflict()
    .doNothing()
    .select(option => ({
      orphan: not(schema.field.where(field => field.id.eq(option.fieldId)).exists()),
    }))
  const upsert = schema.form
    .insert({ id: 1 })
    .onConflict("id")
    .update((form, excluded) => ({
      id: sql(t.integer)`${excluded.id} + ${form.fields.count()}`,
    }))

  expect(compileStatement(lowerStatement(remove.node)).text).toBe(
    'DELETE FROM "form" AS "form" WHERE NOT EXISTS (SELECT FROM "form_field" AS "form_field" WHERE "form_field"."formId" = "form"."id")',
  )
  expect(compileStatement(lowerStatement(update.node)).text).toBe(
    'UPDATE "form_field" AS "form_field" SET "formId" = CASE WHEN EXISTS (SELECT FROM "form" AS "form") THEN 1 ELSE 0 END WHERE "form_field"."id" = $1',
  )
  expect(compileStatement(lowerStatement(insert.node)).text).toBe(
    'INSERT INTO "field_option" AS "field_option" ("fieldId") VALUES (CASE WHEN EXISTS (SELECT FROM "form" AS "form") THEN 1 ELSE 0 END) ON CONFLICT DO NOTHING RETURNING NOT EXISTS (SELECT FROM "form_field" AS "form_field" WHERE "form_field"."id" = "field_option"."fieldId") AS "orphan"',
  )
  expect(compileStatement(lowerStatement(upsert.node)).text).toBe(
    'INSERT INTO "form" AS "form" ("id") VALUES ($1) ON CONFLICT ("id") DO UPDATE SET "id" = "excluded"."id" + (SELECT count(*) AS "count" FROM "form_field" AS "form_field" WHERE "form_field"."formId" = "form"."id")',
  )
})

it("checks the relations and the Db of the nested queries of a mutation", () => {
  const database = createDatabase({ driver: createRecordingDriver().driver })
  const db = bindSchema(schema, database)
  const { node } = schema.field.insert({ id: 1, formId: 1, label: "Name" }).select(field => ({
    options: field.options,
    forms: db.form,
  }))

  expect(() => lowerStatement(node, collectDefinitions(forms[schemaRelations]))).toThrow(
    'Relation "field.options" is not part of the schema',
  )
  expect(() => lowerStatement(node, undefined, bindSchema(schema, database))).toThrow(
    'Selected field "forms" is bound to another Db',
  )
  expect(() => lowerStatement(node, collectDefinitions(schema[schemaRelations]), db)).not.toThrow()
})
