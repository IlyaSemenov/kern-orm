import { describe, expect, it } from "bun:test"

import { describePostgres } from "../../testing/postgres"
import { compileStatement } from "../compiler/postgres/compile"
import { count } from "../expression/aggregates"
import { not } from "../expression/predicates"
import { sql } from "../expression/sql"
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

it("replaces a query of exists in a condition with EXISTS of its rows, and another query of one value with a scalar subquery of its statement", () => {
  const { node } = schema.form
    .where(form => form.fields.exists())
    .where(form => not(form.fields.where({ label: "Email" }).exists()))
    .where(() => schema.field.get(field => field.label.eq("Name")))
    .where(form => form.fields.some(field => field.label.eq("Phone")))

  expect(compileStatement(lowerQuery(node))).toMatchObject({
    text: 'SELECT FROM "form" AS "form" WHERE EXISTS (SELECT FROM "form_field" AS "form_field" WHERE "form_field"."formId" = "form"."id") AND NOT EXISTS (SELECT FROM "form_field" AS "form_field_2" WHERE "form_field_2"."formId" = "form"."id" AND "form_field_2"."label" = $1) AND (SELECT "form_field_3"."label" = $2 AS "value" FROM "form_field" AS "form_field_3" LIMIT 1) AND (SELECT bool_or("form_field_4"."label" = $3) AS "some" FROM "form_field" AS "form_field_4" WHERE "form_field_4"."formId" = "form"."id")',
    parameters: ["Email", "Name", "Phone"],
  })
})

it("replaces a query of records or of rows many in SQL text with its statement in parentheses, and a query of one value with its value, as in a condition", () => {
  const { node } = schema.form
    .where(form => sql`EXISTS ${form.fields.where({ label: "Email" })}`)
    .where(form => sql`${form.id} = ANY ${schema.field.orderBy("label").limit(2).pluck("formId")}`)
    .where(form => sql`${form.fields.count()} > ${1} OR ${form.fields.exists()}`)

  expect(compileStatement(lowerQuery(node))).toMatchObject({
    text: 'SELECT FROM "form" AS "form" WHERE (EXISTS (SELECT FROM "form_field" AS "form_field" WHERE "form_field"."formId" = "form"."id" AND "form_field"."label" = $1)) AND ("form"."id" = ANY (SELECT "form_field_2"."formId" AS "formId" FROM "form_field" AS "form_field_2" ORDER BY "form_field_2"."label" LIMIT $2)) AND ((SELECT count(*) AS "count" FROM "form_field" AS "form_field_3" WHERE "form_field_3"."formId" = "form"."id") > $3 OR EXISTS (SELECT FROM "form_field" AS "form_field_4" WHERE "form_field_4"."formId" = "form"."id"))',
    parameters: ["Email", "2", "1"],
  })
})

describe("query with a row lock", () => {
  const compile = (query: AnySelectQuery) => compileStatement(lowerStatement(query.node)).text

  it("locks the rows of a query in a condition, a sort key, and a fragment of SQL, which are its statement", () => {
    const lockedForm = schema.form.find(1).get("id").forShare()
    const subquery =
      '(SELECT "form"."id" AS "id" FROM "form" AS "form" WHERE "form"."id" = $1 FOR SHARE)'

    expect(compile(schema.field.where(field => field.formId.eq(lockedForm)))).toBe(
      `SELECT FROM "form_field" AS "form_field" WHERE "form_field"."formId" = ${subquery}`,
    )
    expect(compile(schema.field.orderBy(() => lockedForm))).toBe(
      `SELECT FROM "form_field" AS "form_field" ORDER BY ${subquery}`,
    )
    expect(
      compile(schema.field.where(field => sql<boolean>`${field.formId} = ${lockedForm}`)),
    ).toBe(`SELECT FROM "form_field" AS "form_field" WHERE "form_field"."formId" = ${subquery}`)
  })

  it("locks the rows of the query of the values of in", () => {
    expect(
      compile(
        schema.field.where(field =>
          field.formId.in(
            schema.form.orderBy("id").limit(2).pluck("id").forUpdate({ skipLocked: true }),
          ),
        ),
      ),
    ).toBe(
      'SELECT FROM "form_field" AS "form_field" WHERE "form_field"."formId" IN (SELECT "form"."id" AS "id" FROM "form" AS "form" ORDER BY "form"."id" LIMIT $1 FOR UPDATE SKIP LOCKED)',
    )
  })
})

describe("query of groups", () => {
  const compile = (query: AnySelectQuery) => compileStatement(lowerStatement(query.node)).text

  it("sorts by the positions of its projections as a subquery, of IN, after take, and in SQL text, whose repeated sort expression would get parameters of its own", () => {
    const residues = schema.field
      .pluck(field => sql(t.integer)`${field.id} % ${3}`)
      .groupBy((_field, value) => value)
      .orderBy((_field, value) => desc(value))
    const statement =
      'SELECT "form_field"."id" % $1 AS "value" FROM "form_field" AS "form_field" GROUP BY 1 ORDER BY 1 DESC'

    expect(compile(schema.form.where(form => form.id.in(residues)).select("id"))).toEndWith(
      `WHERE "form"."id" IN (${statement})`,
    )
    expect(compile(schema.form.where(form => form.id.eq(residues.take())).select("id"))).toEndWith(
      `WHERE "form"."id" = (${statement} LIMIT 1)`,
    )
    expect(
      compile(schema.form.where(form => sql<boolean>`${form.id} IN ${residues}`).select("id")),
    ).toEndWith(`WHERE "form"."id" IN (${statement})`)
  })

  it("takes the node of the lowered projection for a key of a selected field that holds a query, to group by its position", () => {
    const value = schema.field
      .select(field => ({
        name: field.form.get("id").expr(),
        fieldCount: count(),
      }))
      .groupBy((_field, selected) => selected.name)
    const aggregate = schema.form
      .select(form => ({
        size: form.fields.count(),
        forms: count(),
      }))
      .groupBy((_form, selected) => selected.size)

    expect(compile(value)).toEndWith(' FROM "form_field" AS "form_field" GROUP BY 1')
    expect(compile(aggregate)).toEndWith(' FROM "form" AS "form" GROUP BY 1')
  })

  it("keeps the keys and the condition of the groups in EXISTS", () => {
    const groups = schema.field.groupBy("formId").having(() => count().gt(1))

    expect(compile(groups.exists())).toBe(
      'SELECT EXISTS (SELECT FROM "form_field" AS "form_field" GROUP BY "form_field"."formId" HAVING count(*) > $1) AS "exists"',
    )
    expect(compile(schema.form.where(() => groups.exists()).select("id"))).toEndWith(
      'WHERE EXISTS (SELECT FROM "form_field" AS "form_field" GROUP BY "form_field"."formId" HAVING count(*) > $1)',
    )
  })
})

describe("query of distinct", () => {
  const compile = (query: AnySelectQuery) => compileStatement(lowerStatement(query.node)).text

  it("sorts by the positions of its projections, also as a subquery, whose repeated sort expression would get parameters of its own", () => {
    const shifted = schema.field
      .pluck(field => sql(t.integer)`${field.id} + ${1}`)
      .distinct()
      .orderBy((_field, value) => desc(value))
      .limit(2)
    const subquery =
      'SELECT DISTINCT "form_field"."id" + $1 AS "value" FROM "form_field" AS "form_field" ORDER BY 1 DESC LIMIT $2'

    expect(compile(shifted)).toBe(subquery)
    expect(compile(schema.form.where(form => form.id.in(shifted)))).toBe(
      `SELECT FROM "form" AS "form" WHERE "form"."id" IN (${subquery})`,
    )
    expect(compile(schema.form.where(form => form.id.eq(shifted.take())))).toBe(
      `SELECT FROM "form" AS "form" WHERE "form"."id" = (${subquery.replace("LIMIT $2", "LIMIT 1")})`,
    )
    expect(compile(schema.form.where(form => sql<boolean>`${form.id} IN ${shifted}`))).toBe(
      `SELECT FROM "form" AS "form" WHERE "form"."id" IN (${subquery})`,
    )
  })
})

describePostgres("in PostgreSQL", ({ database, testTransaction, useTestFixture }) => {
  useTestFixture(() =>
    database.script(`
      CREATE TABLE form (id integer);
      INSERT INTO form SELECT generate_series(1, 20);
    `),
  )

  const db = database.bind(defineSchema({ form }))

  it("tells whether a query has a row, also of a page", async () => {
    const results = await testTransaction(async () => [
      await db.form.exists(),
      await db.form.where(form => form.id.gt(20)).exists(),
      await db.form.offset(19).exists(),
      await db.form.offset(20).exists(),
      await db.form.limit(0).exists(),
    ])

    expect(results).toEqual([true, false, true, false, false])
  })
})
