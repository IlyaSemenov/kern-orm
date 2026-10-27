import { describe, expect, it } from "bun:test"

import { describePostgres } from "../../testing/postgres"
import { createRecordingDriver } from "../../testing/recording-driver"
import { createDatabase } from "../execution/database"
import { sql } from "../expression/sql"
import { NotFoundError } from "../result/result"
import { many } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { AnyRecordQuery } from "./record"

const form = defineTable("form", {
  id: t.integer.primaryKey(),
  name: t.text,
})

const field = defineTable("form_field", {
  id: t.integer.primaryKey(),
  formId: t.integer.columnName("form_id"),
  label: t.text,
})

const schema = defineSchema({ form, field }).$relations({
  form: {
    fields: many(field, { from: "id", to: "formId" }),
  },
})

describe("queries of $select", () => {
  it("select the values of expressions and the packed rows of queries as the fields of one row without FROM", () => {
    const { text } = schema
      .$select({
        number: sql(t.integer)`1`,
        names: schema.form.pluck("name"),
      })
      .toSQL({ schemaName: "app" })

    expect(text).toStartWith('SELECT 1 AS "number", (SELECT coalesce(json_agg(')
    expect(text).toEndWith('FROM "app"."form" AS "form") AS "subquery") AS "names"')
  })

  it("reject a query of $select as a field", () => {
    expect(() =>
      schema.$select({
        // @ts-expect-error A query of $select is not a field.
        nested: schema.$select({}),
      }),
    ).toThrow('Selected field "nested" is a query of $select, which cannot be nested')
  })

  it("execute on their Db when awaited only when bound", async () => {
    const { driver, statements } = createRecordingDriver({ respond: () => ({ rows: [["1"]] }) })
    const db = createDatabase({ driver }).bind(schema)
    const query = db.$select({
      number: sql(t.integer)`1`,
    })

    expect(schema.$select({}).then).toBeUndefined()
    expect(await query).toEqual({ number: 1 })
    expect(statements).toEqual([
      { connection: "pool", text: 'SELECT 1 AS "number"', parameters: [] },
    ])
  })

  it("compile a bound query as its Db executes it, rejecting compile options", () => {
    const db = createDatabase({ driver: createRecordingDriver().driver }).bind(schema, {
      schemaName: "app",
    })
    const query = db.$select({
      names: db.form.pluck("name"),
    })
    const either: AnyRecordQuery = query

    expect(query.toSQL()).toEqual(db.$compile(query))
    expect(query.toSQL().text).toContain('FROM "app"."form"')
    expect(() => either.toSQL({ schemaName: "other" })).toThrow(
      "A query bound to a Db compiles with the options of its Db",
    )
  })

  it("compile an unbound query with a field bound to a Db only on that Db", () => {
    const db = createDatabase({ driver: createRecordingDriver().driver }).bind(schema, {
      schemaName: "app",
    })
    const query = schema.$select({
      names: db.form.pluck("name"),
    })

    expect(() => query.toSQL()).toThrow(
      'Selected field "names" is bound to a Db, so only that Db can compile the query',
    )
    expect(db.$compile(query).text).toContain('FROM "app"."form"')
  })
})

describePostgres("in PostgreSQL", ({ database, testTransaction, useTestFixture }) => {
  useTestFixture(() =>
    database.script(`
      CREATE TABLE form (id integer, name text);
      CREATE TABLE form_field (id integer, form_id integer, label text);
      INSERT INTO form VALUES (1, 'Survey'), (2, 'Feedback');
      INSERT INTO form_field VALUES (1, 1, 'Name'), (2, 1, 'Email');
    `),
  )

  const db = database.bind(schema)

  it("gives each field the result of its query as it is executed", async () => {
    const page = db.$select({
      forms: db.form
        .orderBy("id")
        .select("name")
        .select(form => ({
          labels: form.fields.orderBy("id").pluck("label"),
        })),
      formCount: db.form.count(),
      survey: db.form.find(1).select("name"),
      missing: db.form.find(3).select("name").optional(),
      missingName: db.form.find(3).get("name").optional(),
      noLabels: schema.field.where({ formId: 2 }).pluck("label"),
      number: sql(t.integer)`1 + 1`,
    })

    expect(await testTransaction(async () => await page)).toStrictEqual({
      forms: [
        { name: "Survey", labels: ["Name", "Email"] },
        { name: "Feedback", labels: [] },
      ],
      formCount: 2,
      survey: { name: "Survey" },
      missing: undefined,
      missingName: undefined,
      noLabels: [],
      number: 2,
    })
  })

  it("selects a record without fields from an empty selection", async () => {
    expect(await testTransaction(async () => await db.$select({}))).toStrictEqual({})
  })

  it("rejects a missing row of a field of one row with NotFoundError naming the field", async () => {
    const page = db.$select({
      survey: db.form.find(1).select("name"),
      missing: db.form.find(3).select("name"),
    })

    const rejection = testTransaction(async () => await page)
    await expect(rejection).rejects.toThrow(NotFoundError)
    await expect(rejection).rejects.toMatchObject({ path: "missing" })
  })
})
