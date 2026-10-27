import { describe, expect, it } from "bun:test"

import type { Driver, DriverResult } from "kern-orm"
import { createDatabase, defineSchema, many } from "kern-orm"
import { provide, withOverrides } from "ripple-di"

import {
  getField,
  getFieldLabels,
  getForm,
  getPublishedFormNames,
  listFormPreviews,
  listSubmissions,
  publishedForms,
  useFormsDb,
} from "../src/queries"
import { formsSchema, saasSchema, tenantSchema } from "../src/schemas"
import { answer, field, form, user } from "../src/tables"

const unusedDriver: Driver = {
  execute: () => Promise.reject(new Error("unused")),
  acquire: () => Promise.reject(new Error("unused")),
  close: () => Promise.resolve(),
}
const database = createDatabase({ driver: unusedDriver })

/** Binds the tenant and SaaS schemas to a database that records the text of its statements and returns `rows`. */
function connectRecorded(rows: DriverResult["rows"]) {
  const texts: string[] = []
  const driver: Driver = {
    ...unusedDriver,
    execute: statement => {
      texts.push(statement.text)
      return Promise.resolve({ command: "SELECT", rows })
    },
  }
  const recorded = createDatabase({ driver })
  return {
    tenantDb: recorded.bind(tenantSchema, { schemaName: "tenant_1" }),
    saasDb: recorded.bind(saasSchema, { schemaName: "saas" }),
    texts,
  }
}

describe("shared form tables", () => {
  it("compile into the PostgreSQL schema of each Db", () => {
    let currentTenant = "tenant_1"
    const tenantDb = database.bind(tenantSchema, { schemaName: () => currentTenant })
    const saasDb = database.bind(saasSchema, { schemaName: "saas" })

    expect(tenantDb.$compile(publishedForms).text).toContain('FROM "tenant_1"."form"')
    currentTenant = "tenant_2"
    expect(tenantDb.$compile(publishedForms).text).toContain('FROM "tenant_2"."form"')
    expect(saasDb.$compile(publishedForms).text).toContain('FROM "saas"."form"')
  })

  it("reject tables of another schema", () => {
    const saasDb = database.bind(saasSchema, { schemaName: "saas" })

    // @ts-expect-error The SaaS schema has no answers.
    expect(() => saasDb.$compile(tenantSchema.answer)).toThrow(
      `Table "${answer.name}" is not part of the schema`,
    )
  })

  it("reject a nested query of the tenant Db in a query of the SaaS Db", () => {
    const tenantDb = database.bind(tenantSchema, { schemaName: "tenant_1" })
    const saasDb = database.bind(saasSchema, { schemaName: "saas" })
    const query = saasDb.form.select("id").select(form => ({
      fields: tenantDb.field.where(field => field.formId.eq(form.id)).pluck("label"),
    }))

    expect(() => saasDb.$compile(query)).toThrow('Selected field "fields" is bound to another Db')
  })

  it("run shared code on the Db of a tenant and of the SaaS", async () => {
    const { tenantDb, saasDb, texts } = connectRecorded([["Name"]])

    expect(await getFieldLabels(tenantDb, "form-id")).toEqual(["Name"])
    expect(await getFieldLabels(saasDb, "form-id")).toEqual(["Name"])
    expect(texts).toEqual([
      expect.stringContaining('FROM "tenant_1"."form_field"'),
      expect.stringContaining('FROM "saas"."form_field"'),
    ])
  })

  it("run shared code on the Db that dependency injection provides", async () => {
    const { tenantDb, saasDb, texts } = connectRecorded([["Name"]])

    expect(await withOverrides(provide(useFormsDb, tenantDb), getPublishedFormNames)).toEqual([
      "Name",
    ])
    expect(await withOverrides(provide(useFormsDb, saasDb), getPublishedFormNames)).toEqual([
      "Name",
    ])
    expect(texts).toEqual([
      expect.stringContaining('FROM "tenant_1"."form"'),
      expect.stringContaining('FROM "saas"."form"'),
    ])
  })
})

describe("shared relations", () => {
  /** Driver row of a form with one field, as `getForm` and `listFormPreviews` select it, and its record. */
  const surveyRow = ["form-id", "Survey", '[["field-id","Name"]]']
  const survey = { id: "form-id", name: "Survey", fields: [{ id: "field-id", label: "Name" }] }

  it("select the fields of a form in their order through the Db of a tenant and of the SaaS", async () => {
    const { tenantDb, saasDb, texts } = connectRecorded([surveyRow])

    expect(await getForm(tenantDb, "form-id")).toEqual(survey)
    expect(await getForm(saasDb, "form-id")).toEqual(survey)
    for (const [index, schemaName] of ["tenant_1", "saas"].entries()) {
      expect(texts[index]).toContain(`FROM "${schemaName}"."form_field"`)
      expect(texts[index]).toContain('ORDER BY "subquery"."$order1", "subquery"."id"')
    }
  })

  it("select the first fields of each form through the Db of a tenant and of the SaaS", async () => {
    const { tenantDb, saasDb, texts } = connectRecorded([surveyRow])

    expect(await listFormPreviews(tenantDb, 3)).toEqual([survey])
    expect(await listFormPreviews(saasDb, 3)).toEqual([survey])
    for (const [index, schemaName] of ["tenant_1", "saas"].entries()) {
      expect(texts[index]).toContain(
        `FROM "${schemaName}"."form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id" ORDER BY 3, 1 LIMIT $1`,
      )
      expect(texts[index]).toEndWith("ORDER BY 2, 1")
    }
  })

  it("select the form of a field through the Db of a tenant and of the SaaS", async () => {
    const { tenantDb, saasDb, texts } = connectRecorded([["field-id", "Name", '["Survey"]']])
    const named = { id: "field-id", label: "Name", formName: "Survey" }

    expect(await getField(tenantDb, "field-id")).toEqual(named)
    expect(await getField(saasDb, "field-id")).toEqual(named)
    for (const [index, schemaName] of ["tenant_1", "saas"].entries()) {
      expect(texts[index]).toContain(
        `FROM "${schemaName}"."form" AS "form" WHERE "form"."id" = "form_field"."form_id"`,
      )
    }
  })

  it("are one definition in the tenant and SaaS schemas", () => {
    expect(() => defineSchema(tenantSchema, saasSchema)).not.toThrow()
  })

  it("reject tenant-only relations on the SaaS Db before SQL runs", () => {
    const saasDb = database.bind(saasSchema, { schemaName: "saas" })
    const answers = tenantSchema.form.select(form => ({
      fields: form.fields.select(field => ({
        answers: field.answers.pluck("value"),
      })),
    }))

    // @ts-expect-error The SaaS schema has no answers.
    expect(() => saasDb.$compile(answers)).toThrow(
      'Relation "field.answers" is not part of the schema',
    )
  })

  it("reject a relation that another schema declared separately before SQL runs", () => {
    const tenantDb = database.bind(tenantSchema, { schemaName: "tenant_1" })
    const otherForms = defineSchema({ form, field }).$relations({
      form: {
        fields: many(field, { from: "id", to: "formId" }),
      },
    })

    expect(() =>
      tenantDb.$compile(
        otherForms.form.select(form => ({
          fields: form.fields,
        })),
      ),
    ).toThrow('Relation "form.fields" is not part of the schema')
  })

  it("cannot be declared again", () => {
    const error = 'Relation "form.fields" has two different definitions'
    const otherForms = defineSchema({ form, field }).$relations({
      form: {
        fields: many(field, { from: "id", to: "formId" }),
      },
    })

    expect(() =>
      defineSchema(formsSchema, { user }).$relations({
        form: {
          fields: many(field, { from: "id", to: "formId" }),
        },
      }),
    ).toThrow(error)
    expect(() => defineSchema(tenantSchema, otherForms)).toThrow(error)
  })
})

describe("tenant relations", () => {
  it("select the user of each submission through the Db of a tenant", async () => {
    const { tenantDb, texts } = connectRecorded([
      ["submission-id", '["user-id","user@example.com"]'],
    ])

    expect(await listSubmissions(tenantDb, "form-id")).toEqual([
      { id: "submission-id", user: { id: "user-id", email: "user@example.com" } },
    ])
    expect(texts[0]).toContain(
      'FROM "tenant_1"."user" AS "user" WHERE "user"."id" = "form_submission"."user_id"',
    )
  })
})
