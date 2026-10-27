import { describe, expectTypeOf, test } from "bun:test"

import type { DbOf, ResultOf } from "kern-orm"
import { createDatabase, defineSchema } from "kern-orm"

import {
  getField,
  getFieldLabels,
  getForm,
  listFormPreviews,
  listSubmissions,
  publishedForms,
  useFormsDb,
} from "../src/queries"
import { formsSchema, saasSchema, tenantSchema } from "../src/schemas"
import { answer, submission, user } from "../src/tables"

declare const database: ReturnType<typeof createDatabase>

describe("schemas", () => {
  test("contain only their own tables", () => {
    // @ts-expect-error The SaaS schema has no answers.
    void saasSchema.answer
  })

  test("type filters by the column", () => {
    tenantSchema.answer.where({ value: "yes" })

    // @ts-expect-error Filter values are typed by the column.
    tenantSchema.answer.where({ value: 1 })
  })
})

describe("Db", () => {
  test("of a tenant and of the SaaS serves shared code of the form tables", () => {
    void getFieldLabels(database.bind(tenantSchema), "form-id")
    void getFieldLabels(database.bind(saasSchema), "form-id")
  })

  test("of a tenant and of the SaaS selects forms with their fields", async () => {
    const form = await getForm(database.bind(saasSchema), "form-id")

    expectTypeOf(form).toEqualTypeOf<{
      id: string
      name: string
      fields: { id: string; label: string }[]
    }>()
  })

  test("of a tenant and of the SaaS lists forms with their first fields", async () => {
    const forms = await listFormPreviews(database.bind(tenantSchema), 3)

    expectTypeOf(forms).toEqualTypeOf<
      {
        id: string
        name: string
        fields: { id: string; label: string }[]
      }[]
    >()
  })

  test("of a tenant and of the SaaS selects a field with the name of its form", async () => {
    const field = await getField(database.bind(tenantSchema), "field-id")

    expectTypeOf(field).toEqualTypeOf<{ id: string; label: string; formName: string }>()
  })

  test("of a tenant selects submissions with their users", async () => {
    const submissions = await listSubmissions(database.bind(tenantSchema), "form-id")

    expectTypeOf(submissions).toEqualTypeOf<{ id: string; user: { id: string; email: string } }[]>()
  })

  test("of the SaaS cannot select tenant-only relations", () => {
    const answers = tenantSchema.field.select(field => ({
      answers: field.answers.pluck("value"),
    }))

    // @ts-expect-error The SaaS schema has no answers.
    void database.bind(saasSchema).$execute(answers)
    void database.bind(tenantSchema).$execute(answers)
  })

  test("from dependency injection gives shared code only the form tables", () => {
    // @ts-expect-error The form tables include no answers.
    void useFormsDb().answer
  })

  test("of the SaaS cannot serve code of a tenant", () => {
    // @ts-expect-error The SaaS schema has no submissions and answers.
    const saasDb: DbOf<typeof tenantSchema> = database.bind(saasSchema)
    void saasDb
  })

  test("of the tenant tables without their relations cannot serve code of a tenant", () => {
    const tables = defineSchema(formsSchema, { user, submission, answer })

    // @ts-expect-error The schema lacks the relations of the tenant schema.
    const tenantDb: DbOf<typeof tenantSchema> = database.bind(tables)
    void tenantDb
  })
})

describe("ResultOf", () => {
  test("has the selected fields", () => {
    const row: ResultOf<typeof publishedForms> = { id: "id", name: "name" }

    // @ts-expect-error The query selects no `published`.
    void row.published
  })

  test("has no fields without `select`", () => {
    const row: ResultOf<typeof saasSchema.form> = {}

    // @ts-expect-error A query without `select` returns records without fields.
    void row.name
  })

  test('has all columns with `select("*")`', () => {
    const allColumns = saasSchema.form.select("*")
    const row: ResultOf<typeof allColumns> = { id: "id", name: "name", published: true }
    void row
  })
})
