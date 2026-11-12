import { describe, expectTypeOf, test } from "bun:test"

import type { DbOf, ResultOf } from "kern-orm"
import { bindSchema, createDatabase, defineSchema } from "kern-orm"

import {
  appendField,
  createFormCard,
  formActivity,
  getField,
  getFieldCountsById,
  getFieldLabels,
  getFieldStats,
  getForm,
  getFormPage,
  getSubmissionReview,
  listFieldConditions,
  listFormCards,
  listFormHeadlines,
  listFormPreviews,
  listFormSummaries,
  listLatestComments,
  listSubmissions,
  listSubmittedFormNames,
  listSubmittedForms,
  listUserActivity,
  lockFieldWithForm,
  publishedForms,
  selectForm,
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
    void getFieldLabels(bindSchema(tenantSchema, database), "form-id")
    void getFieldLabels(bindSchema(saasSchema, database), "form-id")
  })

  test("of a tenant and of the SaaS selects forms with their fields", async () => {
    const form = await getForm(bindSchema(saasSchema, database), "form-id")

    expectTypeOf(form).toEqualTypeOf<{
      id: string
      name: string
      fields: { id: string; label: string }[]
    }>()
  })

  test("of a tenant and of the SaaS lists forms with their first fields", async () => {
    const forms = await listFormPreviews(bindSchema(tenantSchema, database), 3)

    expectTypeOf(forms).toEqualTypeOf<
      {
        id: string
        name: string
        fields: { id: string; label: string }[]
      }[]
    >()
  })

  test("of a tenant and of the SaaS lists forms with aggregates of their fields", async () => {
    const forms = await listFormSummaries(bindSchema(saasSchema, database))

    expectTypeOf(forms).toEqualTypeOf<
      {
        id: string
        name: string
        fieldCount: number
        labels: string
      }[]
    >()
  })

  test("of a tenant and of the SaaS converts the results of its queries in code", async () => {
    type Card = { id: string; name: string; fieldCount: number; title: string }

    expectTypeOf(await listFormCards(bindSchema(tenantSchema, database), 1)).toEqualTypeOf<Card[]>()
    expectTypeOf(
      await createFormCard(bindSchema(saasSchema, database), "name"),
    ).toEqualTypeOf<Card>()
    expectTypeOf(await listFormHeadlines(bindSchema(tenantSchema, database))).toEqualTypeOf<
      string[]
    >()
    expectTypeOf(await getFieldCountsById(bindSchema(saasSchema, database))).toEqualTypeOf<
      Map<string, number>
    >()
  })

  test("of a tenant and of the SaaS selects a form with the number of published forms", async () => {
    const page = await getFormPage(bindSchema(tenantSchema, database), "form-id")

    expectTypeOf(page).toEqualTypeOf<{
      form: { id: string; name: string; fields: { id: string; label: string }[] }
      publishedCount: number
    }>()
  })

  test("of a tenant and of the SaaS selects a field with the name of its form", async () => {
    const field = await getField(bindSchema(tenantSchema, database), "field-id")

    expectTypeOf(field).toEqualTypeOf<{ id: string; label: string; formName: string }>()
  })

  test("of a tenant and of the SaaS selects the fields of a form with the fields they are shown after and before", async () => {
    const fields = await listFieldConditions(bindSchema(saasSchema, database), "form-id")

    expectTypeOf(fields).toEqualTypeOf<
      {
        label: string
        shownAfter: string | undefined
        dependents: string[]
      }[]
    >()
  })

  test("of a tenant selects submissions with their users", async () => {
    const submissions = await listSubmissions(bindSchema(tenantSchema, database), "form-id")

    expectTypeOf(submissions).toEqualTypeOf<{ id: string; user: { id: string; email: string } }[]>()
  })

  test("of a tenant reads several aggregates of the fields of a form in one record", async () => {
    const stats = await getFieldStats(bindSchema(tenantSchema, database), "form-id")

    expectTypeOf(stats).toEqualTypeOf<{ total: number; lastPosition: number | null }>()
  })

  test("of a tenant groups the submissions by form", async () => {
    const forms = await listSubmittedForms(bindSchema(tenantSchema, database), 2)

    expectTypeOf(forms).toEqualTypeOf<{ name: string; submissions: number; reviewed: number }[]>()
  })

  test("of a tenant filters forms by the distinct values of another query", async () => {
    const names = await listSubmittedFormNames(bindSchema(tenantSchema, database))

    expectTypeOf(names).toEqualTypeOf<string[]>()
  })

  test("of a tenant locks a form to add a field at its end, and a field with its form", async () => {
    const db = bindSchema(tenantSchema, database)

    expectTypeOf(await appendField(db, "form-id", "Name")).toEqualTypeOf<number>()
    expectTypeOf(await lockFieldWithForm(db, "field-id")).toEqualTypeOf<{
      label: string
      published: boolean
    }>()
  })

  test("of a tenant selects a submission with its user and reviewer, its answers by their key, and the comments", async () => {
    const review = await getSubmissionReview(bindSchema(tenantSchema, database), "submission-id")

    expectTypeOf(review).toEqualTypeOf<{
      user: string
      reviewer: string | undefined
      fields: {
        label: string
        answer: { value: string; comments: string[] } | undefined
      }[]
      comments: string[]
    }>()
  })

  test("of a tenant counts the submissions that users filled in and reviewed, with the answers of their comments", async () => {
    const users = await listUserActivity(bindSchema(tenantSchema, database))

    expectTypeOf(users).toEqualTypeOf<
      {
        email: string
        submitted: number
        reviewed: number
        comments: { text: string; answer: string | undefined }[]
      }[]
    >()
  })

  test("of a tenant gives the latest comment on each submission with its author", async () => {
    const comments = await listLatestComments(bindSchema(tenantSchema, database))

    expectTypeOf(comments).toEqualTypeOf<{ text: string; author: string }[]>()
  })

  test("of a tenant executes a page of the activity of its forms, which the SaaS lacks", async () => {
    const page = await bindSchema(tenantSchema, database).$execute(formActivity.limit(20))

    expectTypeOf(page).toEqualTypeOf<
      {
        id: string
        name: string
        fields: { label: string; shownAfter: string | undefined }[]
        submissionCount: number
        latestSubmissions: {
          user: string
          reviewer: string | undefined
          answerCount: number
          comments: { author: string; text: string }[]
        }[]
      }[]
    >()
    // @ts-expect-error The SaaS schema has no submissions.
    void bindSchema(saasSchema, database).$execute(formActivity)
  })

  test("of the SaaS cannot select tenant-only relations", () => {
    const answers = tenantSchema.field.select(field => ({
      answers: field.answers.pluck("value"),
    }))

    // @ts-expect-error The SaaS schema has no answers.
    void bindSchema(saasSchema, database).$execute(answers)
    void bindSchema(tenantSchema, database).$execute(answers)
  })

  test("from dependency injection gives shared code only the form tables", () => {
    // @ts-expect-error The form tables include no answers.
    void useFormsDb().answer
  })

  test("of the SaaS cannot serve code of a tenant", () => {
    // @ts-expect-error The SaaS schema has no submissions and answers.
    const saasDb: DbOf<typeof tenantSchema> = bindSchema(saasSchema, database)
    void saasDb
  })

  test("of the tenant tables without their relations cannot serve code of a tenant", () => {
    const tables = defineSchema(formsSchema, { user, submission, answer })

    // @ts-expect-error The schema lacks the relations of the tenant schema.
    const tenantDb: DbOf<typeof tenantSchema> = bindSchema(tables, database)
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

  test("has the fields that a helper selects", () => {
    expectTypeOf<ResultOf<typeof selectForm>>().toEqualTypeOf<{
      id: string
      name: string
      fields: { id: string; label: string }[]
    }>()
  })
})
