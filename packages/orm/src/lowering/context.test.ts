import { expect, it } from "bun:test"

import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"
import { createDatabase } from "kern-db"

import { bindSchema } from "../execution/db"
import { sql } from "../expression/sql"
import { collectDefinitions, many, one } from "../schema/relation"
import { defineSchema, schemaRelations } from "../schema/schema"
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

it("rejects a relation outside the definitions at any depth, also of a query of count, of exists, of an expression, or in a condition", () => {
  for (const { node } of [
    schema.form.select(form => ({
      fields: form.fields.select(field => ({
        options: field.options,
      })),
    })),
    schema.form.select(form => ({
      fields: form.fields.select(field => ({
        optionCount: field.options.count(),
      })),
    })),
    schema.form.select(form => ({
      fields: form.fields.select(field => ({
        hasOptions: field.options.exists(),
      })),
    })),
    schema.form.select(form => ({
      fields: form.fields.select(field => ({
        optionCount: field.options.count().expr(),
      })),
    })),
    schema.form.where(form => form.fields.where(field => field.options.exists()).exists()),
    schema.field.where(field => field.id.in(field.options.pluck("fieldId"))),
  ]) {
    expect(() => lowerQuery(node, collectDefinitions(forms[schemaRelations]))).toThrow(
      'Relation "field.options" is not part of the schema',
    )
    expect(() => lowerQuery(node, collectDefinitions(schema[schemaRelations]))).not.toThrow()
    expect(() => lowerQuery(node)).not.toThrow()
  }
})

it("rejects a nested query bound to another Db than the one given, or to any Db without one, at any depth", () => {
  const database = createDatabase({ driver: createRecordingDriver().driver })
  const db = bindSchema(schema, database)
  const otherDb = bindSchema(schema, database)
  const { node } = schema.form.select(form => ({
    fields: form.fields.select(field => ({
      options: db.option.where(option => option.fieldId.eq(field.id)),
    })),
  }))

  expect(() => lowerQuery(node, undefined, otherDb)).toThrow(
    'Selected field "options" is bound to another Db',
  )
  expect(() => lowerQuery(node, undefined, db)).not.toThrow()
  expect(() => lowerQuery(node)).toThrow(
    'Selected field "options" is bound to a Db, so only that Db can compile the query',
  )
})

it("rejects a query in an expression, also of the values of in and in SQL text, bound to another Db than the one given, or to any Db without one", () => {
  const database = createDatabase({ driver: createRecordingDriver().driver })
  const db = bindSchema(schema, database)
  for (const { node } of [
    schema.form.where(form => db.field.where(field => field.formId.eq(form.id)).exists()),
    schema.form.where(form => form.id.in(db.field.pluck("formId"))),
    schema.form.where(form => sql`${form.id} = ANY ${db.field.pluck("formId")}`),
  ]) {
    expect(() => lowerQuery(node, undefined, bindSchema(schema, database))).toThrow(
      "A query in an expression is bound to another Db",
    )
    expect(() => lowerQuery(node, undefined, db)).not.toThrow()
    expect(() => lowerQuery(node)).toThrow(
      "A query in an expression is bound to a Db, so only that Db can compile the query",
    )
  }
})
