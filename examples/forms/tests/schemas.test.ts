import { describe, expect, it } from "bun:test"

import type { Driver, DriverResult } from "kern-orm"
import { createDatabase, defineSchema, many } from "kern-orm"
import { provide, withOverrides } from "ripple-di"

import {
  appendField,
  createFormCard,
  getField,
  getFieldCountsById,
  getFieldLabels,
  getForm,
  getFormPage,
  getPublishedFormNames,
  listFieldCounts,
  listFormCards,
  listFormHeadlines,
  listFormPreviews,
  listFormsByFieldLabel,
  listFormSummaries,
  listSubmissions,
  listSubmittedFormNames,
  lockFieldWithForm,
  publishedForms,
  publishWithFieldLabel,
  selectForm,
  useFormsDb,
} from "../src/queries"
import { formsSchema, saasSchema, tenantSchema } from "../src/schemas"
import { answer, field, form, user } from "../src/tables"
import { describePostgres, getSampleId } from "../testing/postgres"

const unusedDriver: Driver = {
  execute: () => Promise.reject(new Error("unused")),
  executeScript: () => Promise.reject(new Error("unused")),
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
      return Promise.resolve({ command: "SELECT", count: rows.length, columns: [], rows })
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

  it("aggregate related records in shared code on the Db of a tenant and of the SaaS", async () => {
    const { tenantDb, saasDb, texts } = connectRecorded([["form-id", "Survey", "2", "Name, Email"]])
    const summaries = [{ id: "form-id", name: "Survey", fieldCount: 2, labels: "Name, Email" }]

    expect(await listFormSummaries(tenantDb)).toEqual(summaries)
    expect(await listFormSummaries(saasDb)).toEqual(summaries)
    expect(texts).toEqual([
      expect.stringContaining(
        `(SELECT coalesce(string_agg("form_field_2"."label", $1 ORDER BY "form_field_2"."position"), $2) AS "stringAgg" FROM "tenant_1"."form_field" AS "form_field_2"`,
      ),
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

  it("select a form with the number of published forms in one statement through the Db of a tenant and of the SaaS", async () => {
    const { tenantDb, saasDb, texts } = connectRecorded([
      ['["form-id","Survey",[["field-id","Name"]]]', "2"],
    ])
    const page = { form: survey, publishedCount: 2 }

    expect(await getFormPage(tenantDb, "form-id")).toEqual(page)
    expect(await getFormPage(saasDb, "form-id")).toEqual(page)
    for (const [index, schemaName] of ["tenant_1", "saas"].entries()) {
      expect(texts[index]).toStartWith("SELECT (SELECT json_build_array(")
      expect(texts[index]).toContain(`FROM "${schemaName}"."form_field"`)
      expect(texts[index]).toEndWith(
        `(SELECT count(*) AS "count" FROM "${schemaName}"."form" AS "form_2" WHERE "form_2"."published" = $2) AS "publishedCount"`,
      )
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

describePostgres("in PostgreSQL", ({ testTransaction, tenantDb, saasDb, inTenant }) => {
  it("execute a shared query in the PostgreSQL schema of the tenant of each request and of the SaaS, refined independently", async () => {
    const byName = publishedForms.orderBy("name")
    const names = await testTransaction(async () => ({
      tenants: await Promise.all(
        ["tenant_1", "tenant_2"].map(schemaName =>
          inTenant(schemaName, async () =>
            (await tenantDb.$execute(byName)).map(form => form.name),
          ),
        ),
      ),
      saas: await saasDb.$execute(publishedForms.where({ name: "Contact" }).pluck("name")),
      draft: await saasDb.$execute(publishedForms.where({ name: "Draft" }).pluck("name")),
    }))

    expect(names).toStrictEqual({
      tenants: [["Feedback", "Survey"], ["Onboarding"]],
      saas: ["Contact"],
      draft: [],
    })
  })

  it("apply a shared helper to the queries of a tenant, which add its own relations, and of the SaaS", async () => {
    const forms = await testTransaction(async () => ({
      tenant: await inTenant(
        "tenant_1",
        async () =>
          await tenantDb.form
            .where({ published: true })
            .orderBy("name")
            .use(selectForm)
            .select(form => ({
              submissionCount: form.submissions.count(),
            })),
      ),
      saas: await saasDb.form.where({ published: true }).use(selectForm),
    }))

    expect(forms).toMatchObject({
      tenant: [
        { name: "Feedback", fields: [{ label: "Comment" }], submissionCount: 1 },
        {
          name: "Survey",
          fields: [
            { label: "Name" },
            { label: "Has pets" },
            { label: "Pet name" },
            { label: "Pet age" },
          ],
          submissionCount: 2,
        },
      ],
      saas: [
        { name: "Contact", fields: [{ label: "Name" }, { label: "Email" }, { label: "Phone" }] },
      ],
    })
  })

  it("filter by, sort by, and select a shared expression through the Db of a tenant and of the SaaS", async () => {
    const forms = await testTransaction(async () => ({
      tenant: await inTenant("tenant_1", async () => {
        // Unpublished and last by name, so only the expression lets the filter keep it and sorts it first.
        const formId = await tenantDb.form.insert({ name: "Zoo", published: false }).get("id")
        await tenantDb.field.insert({ formId, position: 1, label: "Species" })
        return await listFormsByFieldLabel(tenantDb, "Species")
      }),
      saas: await listFormsByFieldLabel(saasDb, "Email"),
    }))

    expect(forms).toStrictEqual({
      tenant: [
        { name: "Zoo", hasField: true },
        { name: "Feedback", hasField: false },
        { name: "Survey", hasField: false },
      ],
      saas: [{ name: "Contact", hasField: true }],
    })
  })

  it("filter by the distinct values of another query through the Db of a tenant", async () => {
    const names = await testTransaction(() =>
      inTenant("tenant_1", () => listSubmittedFormNames(tenantDb)),
    )

    // Without the unpublished `Archive`, which has no submissions, and with `Survey` once, which has two.
    expect(names).toStrictEqual(["Feedback", "Survey"])
  })

  it("lock a form to add a field at its end through the Db of a tenant and of the SaaS", async () => {
    const positions = await testTransaction(async () => ({
      tenant: await inTenant("tenant_1", () =>
        appendField(tenantDb, getSampleId("form:survey"), "Nickname"),
      ),
      saas: await appendField(saasDb, getSampleId("form:contact"), "Fax"),
    }))

    expect(positions).toStrictEqual({ tenant: 5, saas: 4 })
  })

  it("lock a field with its form, nested in the query of the field, in a transaction that the query joins", async () => {
    const locked = await testTransaction(() =>
      inTenant("tenant_1", () =>
        tenantDb.$transaction(() => lockFieldWithForm(tenantDb, getSampleId("field:survey:name"))),
      ),
    )

    expect(locked).toStrictEqual({ label: "Name", published: true })
  })

  it("read a relation and call a shared expression in the callbacks of values through the Db of a tenant and of the SaaS", async () => {
    const results = await testTransaction(async () => {
      const blankId = await saasDb.form.insert({ name: "Blank", published: true }).get("id")
      await publishWithFieldLabel(saasDb, blankId, "Email")
      return {
        tenant: await inTenant("tenant_1", async () => {
          const zooId = await tenantDb.form.insert({ name: "Zoo", published: false }).get("id")
          await tenantDb.field.insert({ formId: zooId, position: 1, label: "Species" })
          await publishWithFieldLabel(tenantDb, zooId, "Species")
          return await tenantDb.form.find(zooId).get("published")
        }),
        saas: await saasDb.form.find(blankId).get("published"),
        counts: await listFieldCounts(saasDb),
      }
    })

    expect(results).toStrictEqual({ tenant: true, saas: false, counts: [3] })
  })

  it("convert the results of shared queries in code through the Db of a tenant and of the SaaS", async () => {
    const results = await testTransaction(async () => ({
      tenant: await inTenant("tenant_1", async () => ({
        headlines: await listFormHeadlines(tenantDb),
        counts: await getFieldCountsById(tenantDb),
      })),
      saas: {
        headlines: await listFormHeadlines(saasDb),
        counts: await getFieldCountsById(saasDb),
      },
    }))

    expect(results.tenant.headlines).toStrictEqual([
      "Archive: ",
      "Feedback: comment",
      "Survey: name, has pets, pet name, pet age",
    ])
    expect([...results.tenant.counts.values()].toSorted()).toStrictEqual([0, 1, 4])
    expect(results.saas.headlines).toStrictEqual(["Contact: name, email, phone", "Draft: "])
    expect([...results.saas.counts.values()].toSorted()).toStrictEqual([0, 3])
  })

  it("apply one helper that converts in code to a query and to an insert, through the Db of a tenant and of the SaaS", async () => {
    const results = await testTransaction(async () => ({
      tenant: await inTenant("tenant_1", async () => ({
        cards: await listFormCards(tenantDb, 1),
        created: await createFormCard(tenantDb, "Zoo"),
      })),
      saas: {
        cards: await listFormCards(saasDb, 1),
        created: await createFormCard(saasDb, "Blank"),
      },
    }))

    expect(results.tenant.cards).toMatchObject([
      { name: "Feedback", fieldCount: 1, title: "Feedback" },
    ])
    expect(results.tenant.created).toMatchObject({
      name: "Zoo",
      fieldCount: 0,
      title: "Zoo (empty)",
    })
    expect(results.saas.cards).toMatchObject([{ name: "Contact", fieldCount: 3, title: "Contact" }])
    expect(results.saas.created).toMatchObject({
      name: "Blank",
      fieldCount: 0,
      title: "Blank (empty)",
    })
  })

  it("run shared code on the Db that dependency injection provides, in the PostgreSQL schema of the tenant of the request", async () => {
    const names = await testTransaction(async () => ({
      tenant: await inTenant("tenant_2", () =>
        withOverrides(provide(useFormsDb, tenantDb), getPublishedFormNames),
      ),
      saas: await withOverrides(provide(useFormsDb, saasDb), getPublishedFormNames),
    }))

    expect(names).toStrictEqual({ tenant: ["Onboarding"], saas: ["Contact"] })
  })
})
