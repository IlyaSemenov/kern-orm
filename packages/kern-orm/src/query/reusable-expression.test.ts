import { expect, test } from "bun:test"

import { many, one } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { desc } from "./order"
import { defineExpression } from "./reusable-expression"

const form = defineTable("form", {
  id: t.uuid.primaryKey(),
  name: t.text,
})

const field = defineTable("field", {
  id: t.uuid.primaryKey(),
  formId: t.uuid,
  name: t.text,
})

const schema = defineSchema({ form, field }).$relations({
  form: {
    fields: many(field, { from: "id", to: "formId" }),
  },
  field: {
    form: one(form, { from: "formId", to: "id", required: true }),
  },
})

const hasField = defineExpression(schema.form, (form, name: string) =>
  form.fields.where({ name }).exists(),
)

const isNamed = defineExpression(form, (form, name: string) => form.name.eq(name))

test("compiles as its callback in where, select, and orderBy", () => {
  const query = schema.form
    .where(form => hasField(form, "Email"))
    .orderBy(form => desc(hasField(form, "Phone")))
    .select(form => ({
      id: form.id,
      hasField: hasField(form, "Name"),
    }))

  expect(query.toSQL()).toEqual(
    schema.form
      .where(form => form.fields.where({ name: "Email" }).exists())
      .orderBy(form => desc(form.fields.where({ name: "Phone" }).exists()))
      .select(form => ({
        id: form.id,
        hasField: form.fields.where({ name: "Name" }).exists(),
      }))
      .toSQL(),
  )
})

test("applies directly to where and orderBy without further arguments", () => {
  const hasFields = defineExpression(schema.form, form => form.fields.exists())

  expect(schema.form.where(hasFields).orderBy(hasFields).select("id").toSQL()).toEqual(
    schema.form
      .where(form => form.fields.exists())
      .orderBy(form => form.fields.exists())
      .select("id")
      .toSQL(),
  )
})

test("refers to the occurrence of the table it is called with", () => {
  // Both tables have `name`, so a column of the table of the inner `where` would compile as well.
  const outer = schema.form
    .where(form => form.fields.where(() => isNamed(form, "Survey")).exists())
    .select("id")
  const inner = schema.form
    .where(form =>
      form.fields
        .where(field => field.form.where(parent => isNamed(parent, "Survey")).exists())
        .exists(),
    )
    .select("id")

  expect(outer.toSQL()).toEqual(
    schema.form
      .where(form => form.fields.where(() => form.name.eq("Survey")).exists())
      .select("id")
      .toSQL(),
  )
  expect(inner.toSQL()).toEqual(
    schema.form
      .where(form =>
        form.fields
          .where(field => field.form.where(parent => parent.name.eq("Survey")).exists())
          .exists(),
      )
      .select("id")
      .toSQL(),
  )
})
