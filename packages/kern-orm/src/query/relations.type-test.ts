import { describe, expectTypeOf, test } from "bun:test"

import { createRecordingDriver } from "../../testing/recording-driver"
import { createDatabase } from "../execution/database"
import { many, one } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { QueryResult } from "./rows"
import type { AnySelectQuery, EmptyRecord } from "./select"
import { from } from "./select"
import type { Selection } from "./selection"

const form = defineTable("form", {
  id: t.uuid.primaryKey(),
  name: t.text,
})
const field = defineTable("field", {
  id: t.uuid.primaryKey(),
  formId: t.uuid,
  label: t.text.nullable(),
})
/** An answer keeps its value when its field is removed. */
const answer = defineTable("answer", {
  id: t.uuid.primaryKey(),
  fieldId: t.uuid.nullable(),
  value: t.text,
})

const forms = defineSchema({ form, field }).$relations({
  form: {
    fields: many(field, { from: "id", to: "formId" }),
  },
  field: {
    form: one(form, { from: "formId", to: "id" }),
  },
})
const tenant = defineSchema(forms, { answer }).$relations({
  field: {
    answers: many(answer, { from: "id", to: "fieldId" }),
  },
  answer: {
    field: one(field, { from: "fieldId", to: "id" }),
  },
})
const tenantDb = createDatabase({ driver: createRecordingDriver().driver }).bind(tenant)

/** Result of executing query `Q`. */
type Executed<Q extends AnySelectQuery> = QueryResult<Q["types"]>

describe("select", () => {
  test("gives the records of a relation many as an array", () => {
    const query = forms.form.select(form => ({
      id: form.id,
      fields: form.fields.select("label"),
    }))

    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<
      { id: string; fields: { label: string | null }[] }[]
    >()
  })

  test("gives the record of a relation one, and null without it unless the relation is required", () => {
    const query = tenant.answer.select(answer => ({
      field: answer.field.select("label").select(field => ({
        form: field.form.select("name"),
      })),
    }))

    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<
      { field: { label: string | null; form: { name: string } } | null }[]
    >()
  })

  test("applies the methods of a query of one row to a relation one", () => {
    const answers = tenant.answer.select(answer => ({
      taken: answer.field.select("id").take(),
      optional: answer.field.select("id").optional(),
      required: answer.field.select("id").required(),
      id: answer.field.get("id"),
      plucked: answer.field.pluck("id"),
    }))
    const fields = tenant.field.select(field => ({
      form: field.form.select("id").nullable(),
    }))

    expectTypeOf<Executed<typeof answers>>().toEqualTypeOf<
      {
        taken: { id: string } | null
        optional: { id: string } | undefined
        required: { id: string }
        id: string
        plucked: string
      }[]
    >()
    expectTypeOf<Executed<typeof fields>>().toEqualTypeOf<{ form: { id: string } | null }[]>()
    tenant.answer.select(answer => ({
      // @ts-expect-error A relation one has no pagination.
      field: answer.field.limit(1),
    }))
    tenant.answer.select(answer => ({
      // @ts-expect-error A relation one has no pagination.
      field: answer.field.offset(1),
    }))
  })

  test("gives one record or value after take, and null or undefined without it after nullable or optional", () => {
    const query = forms.form.select(form => ({
      first: form.fields.select("label").take(),
      firstNullable: form.fields.select("label").take().nullable(),
      firstOptional: form.fields.select("label").take().optional(),
      labels: form.fields.pluck("label"),
      label: form.fields.get("label").optional(),
    }))

    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<
      {
        first: { label: string | null }
        firstNullable: { label: string | null } | null
        firstOptional: { label: string | null } | undefined
        labels: (string | null)[]
        label: string | null | undefined
      }[]
    >()
  })

  test("gives the value of either branch of a field of a query or an expression", () => {
    const pick = (labels: boolean) =>
      forms.form.select(form => ({
        value: labels ? form.fields.pluck("label") : form.name,
      }))

    expectTypeOf<Executed<ReturnType<typeof pick>>>().toEqualTypeOf<
      { value: (string | null)[] | string }[]
    >()
  })

  test("selects the columns and the relations of spread references", () => {
    const spreadForms = forms.form.select(form => ({ ...form }))
    const spreadFields = forms.field.select(field => ({ ...field }))

    expectTypeOf<Executed<typeof spreadForms>>().toEqualTypeOf<
      { id: string; name: string; fields: EmptyRecord[] }[]
    >()
    expectTypeOf<Executed<typeof spreadFields>>().toEqualTypeOf<
      { id: string; formId: string; label: string | null; form: EmptyRecord }[]
    >()
  })

  test("gives the relations of the target table in the schema of the query", () => {
    const query = tenant.form.select(form => ({
      fields: form.fields.select(field => ({
        answers: field.answers.pluck("value"),
      })),
    }))

    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<{ fields: { answers: string[] }[] }[]>()

    forms.form.select(form => ({
      fields: form.fields.select(field => ({
        // @ts-expect-error The forms schema has no answers.
        answers: field.answers,
      })),
    }))
  })

  test("gives an unbound query of a relation to a query of a Db", async () => {
    const forms = await tenantDb.form.select(form => ({
      fields: form.fields.select("id"),
    }))

    expectTypeOf(forms).toEqualTypeOf<{ fields: { id: string }[] }[]>()
  })

  test("gives no relations to a query of from", () => {
    from(form).select(form => ({
      // @ts-expect-error A query of from has no relations.
      fields: form.fields,
    }))
  })

  test("accepts a query of either kind, and rejects a Promise", () => {
    const query = tenantDb.form.select(form => ({
      labels: forms.field.where(field => field.formId.eq(form.id)).pluck("label"),
      answers: tenantDb.answer.pluck("value").take().optional(),
    }))

    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<
      { labels: (string | null)[]; answers: string | undefined }[]
    >()
    // The callback returns a `Selection`, so that the error is reported at the field rather than at the call.
    tenantDb.form.select((): Selection => ({
      // @ts-expect-error A Promise is not a query.
      fields: Promise.resolve([]),
    }))
  })

  test("rejects an object that is not a query, such as a copy of a query", () => {
    // The callbacks return a `Selection`, so that the errors are reported at the fields rather than at the calls.
    forms.form.select((form): Selection => ({
      // @ts-expect-error Only a query nests its rows.
      fields: { types: form.fields.types },
    }))
    forms.form.select((form): Selection => ({
      // @ts-expect-error A copy of a query is not a query.
      fields: { ...form.fields },
    }))
  })
})
