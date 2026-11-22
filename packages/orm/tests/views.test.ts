import { expect, test } from "bun:test"

import { bindSchema, count, defineSchema, defineTable, defineView } from "kern-orm"
import * as t from "kern-orm/types"

import { describePostgres } from "../testing/postgres"

const form = defineTable("form", {
  id: t.uuid,
})
const publishedField = defineView("published_field", {
  formId: t.uuid.columnName("form_id"),
  label: t.text,
})
const schema = defineSchema({ form, publishedField })

test("filters forms by a matching field of a view in the same PostgreSQL schema", () => {
  const query = schema.form.where(form =>
    schema.publishedField.where({ formId: form.id, label: "Email" }).exists(),
  )
  expect(query.toSQL({ schemaName: "tenant" })).toEqual({
    text: 'SELECT FROM "tenant"."form" AS "form" WHERE EXISTS (SELECT FROM "tenant"."published_field" AS "published_field" WHERE "published_field"."form_id" = "form"."id" AND "published_field"."label" = $1)',
    parameters: ["Email"],
  })
})

describePostgres("reading a view", ({ database, testTransaction }) => {
  test("counts matching fields in each group and returns each matching form once", () =>
    testTransaction(async () => {
      await database.script(`
        CREATE TABLE form (id uuid PRIMARY KEY);
        CREATE TABLE form_field (form_id uuid, label text, published boolean);
        CREATE VIEW published_field AS SELECT form_id, label FROM form_field WHERE published;
        INSERT INTO form VALUES
          ('00000000-0000-0000-0000-000000000001'),
          ('00000000-0000-0000-0000-000000000002');
        INSERT INTO form_field VALUES
          ('00000000-0000-0000-0000-000000000001', 'Email', true),
          ('00000000-0000-0000-0000-000000000001', 'Email', true),
          ('00000000-0000-0000-0000-000000000002', 'Email', false);
      `)
      const db = bindSchema(schema, database)
      const ids = await db.form
        .where(form => db.publishedField.where({ formId: form.id, label: "Email" }).exists())
        .pluck("id")
      expect(await db.publishedField.groupBy("formId").pluck(() => count())).toEqual([2])
      expect(ids).toEqual(["00000000-0000-0000-0000-000000000001"])
    }))
})
