import { expect, it } from "bun:test"

import { createRecordingDriver } from "../../testing/database/recording-driver"
import { compileStatement } from "../compiler/postgres/compile"
import { createDatabase } from "../database/database"
import { bindSchema } from "../execution/db"
import { sql } from "../expression/sql"
import { lower } from "../lowering/testing"
import { many } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { defineHelper } from "./helper"
import { desc } from "./order"
import type { AnySelectQuery } from "./select"

const form = defineTable("form", {
  id: t.uuid,
  name: t.text,
  ownerId: t.uuid,
})

const schema = defineSchema({ form })

/** Compiles `query` with the result plan, which `toSQL` leaves out. */
function compile(query: AnySelectQuery) {
  return compileStatement(lower(query))
}

const ownedBy = defineHelper(schema.form, (form, ownerId: string) =>
  form.where({ ownerId }).select("name").take(),
)

it("applies its clauses with arguments to the query it is applied to or called with", () => {
  const query = schema.form.select("id")

  expect(compile(query.use(ownedBy, "owner-id"))).toMatchObject({
    text: 'SELECT "form"."id" AS "id", "form"."name" AS "name" FROM "form" AS "form" WHERE "form"."ownerId" = $1 LIMIT 1',
    parameters: ["owner-id"],
    rows: "one",
  })
  expect(compile(ownedBy(query, "owner-id"))).toEqual(compile(query.use(ownedBy, "owner-id")))
})

it("makes the query it is applied to resolve to null or reject without a row", () => {
  const nullable = defineHelper(schema.form, form => form.take().nullable())
  const required = defineHelper(schema.form, form => form.take().optional().required())

  expect(compile(schema.form.select("id").use(nullable))).toMatchObject({ rows: "nullable" })
  expect(compile(schema.form.take().optional().use(required))).toMatchObject({ rows: "one" })
  // Types accept the helper, since its effect records only the rows mode it ends with.
  const reset = defineHelper(schema.form, form => form.take().nullable().optional())
  expect(() => schema.form.get("name").use(reset)).toThrow(
    "nullable applies only to a query of records; use optional after get, pluck, or an aggregate",
  )
})

it("sorts and paginates the query it is applied to, which must be a query of many rows", () => {
  const page = defineHelper(schema.form, (form, size: number) =>
    form
      .select("name")
      .orderBy((_columns, selected) => desc(selected.name))
      .limit(size),
  )

  expect(schema.form.select("id").use(page, 10).toSQL()).toEqual({
    text: 'SELECT "form"."id" AS "id", "form"."name" AS "name" FROM "form" AS "form" ORDER BY 2 DESC LIMIT $1',
    parameters: ["10"],
  })
  // Types accept the helper, since its effect does not record the pagination.
  expect(() => schema.form.take().use(page, 10)).toThrow(
    "limit applies only to a query of many rows; call it before take or get",
  )
})

it("removes the duplicates of the rows of the query it is applied to, which must be a query of many rows", () => {
  const unique = defineHelper(schema.form, form => form.select("name").distinct())

  expect(schema.form.use(unique).toSQL().text).toBe(
    'SELECT DISTINCT "form"."name" AS "name" FROM "form" AS "form"',
  )
  // Types accept the helper, since its effect does not record `distinct`.
  expect(() => schema.form.take().use(unique)).toThrow(
    "distinct applies only to a query of many rows",
  )
})

it("groups the rows of the query it is applied to, which must return rows of its table without a row lock", () => {
  const grouped = defineHelper(schema.form, form => form.groupBy("name"))
  const groupedQuery = schema.form.select("name").use(grouped)
  const filtered = defineHelper(schema.form, form =>
    form.groupBy("name").having({ name: "Survey" }),
  )

  expect(groupedQuery.toSQL().text).toBe(
    'SELECT "form"."name" AS "name" FROM "form" AS "form" GROUP BY 1',
  )
  expect(schema.form.select("name").use(filtered).toSQL().text).toBe(
    'SELECT "form"."name" AS "name" FROM "form" AS "form" GROUP BY 1 HAVING "form"."name" = $1',
  )
  // @ts-expect-error A grouping helper rejects an aggregate query in types too.
  expect(() => schema.form.count().use(grouped)).toThrow(
    "groupBy cannot be used after an aggregate",
  )
  // @ts-expect-error A grouping helper rejects a query of exists.
  expect(() => schema.form.exists().use(grouped)).toThrow("groupBy cannot be used after exists")
  const mapped = schema.form.select("name").map(row => row.name)
  // @ts-expect-error A grouping helper rejects a converted query.
  expect(() => mapped.use(grouped)).toThrow("groupBy cannot be used after map")
  expect(() => schema.form.forUpdate().use(grouped)).toThrow(
    "groupBy cannot be used after a row lock, since a group comes from several rows of the table",
  )
})

it("locks the rows of the query it is applied to", () => {
  const locked = defineHelper(schema.form, form => form.select("name").forUpdate())

  expect(schema.form.use(locked).toSQL().text).toBe(
    'SELECT "form"."name" AS "name" FROM "form" AS "form" FOR UPDATE',
  )
})

it("applies a helper inside another helper", () => {
  const ownedNamesWithId = defineHelper(schema.form, (form, ownerId: string) =>
    form.use(ownedBy, ownerId).select("id"),
  )

  expect(compile(schema.form.use(ownedNamesWithId, "owner-id"))).toMatchObject({
    text: 'SELECT "form"."name" AS "name", "form"."id" AS "id" FROM "form" AS "form" WHERE "form"."ownerId" = $1 LIMIT 1',
    parameters: ["owner-id"],
    rows: "one",
  })
})

it("replaces a field through nested helpers without changing the input query", () => {
  const withNameLength = defineHelper(schema.form, form =>
    form.select(columns => ({
      name: sql(t.integer)`length(${columns.name})`,
    })),
  )
  const named = defineHelper(schema.form, form => form.use(withNameLength).select("name"))
  const query = schema.form.select(() => ({
    name: sql(t.integer)`${7}`,
  }))

  expect(compile(query.use(named).use(named))).toMatchObject({
    text: 'SELECT "form"."name" AS "name" FROM "form" AS "form"',
    parameters: [],
    fields: [{ key: "name", type: t.text }],
  })
  expect(compile(query)).toMatchObject({
    parameters: ["7"],
    fields: [{ key: "name", type: t.integer }],
  })
})

it("replaces a field only in the branch of the helper that selects it", () => {
  const maybeWithName = defineHelper(schema.form, (form, withName: boolean) =>
    withName ? form.select("name") : form,
  )
  const query = schema.form.select(() => ({
    name: sql(t.integer)`${7}`,
  }))

  expect(compile(query.use(maybeWithName, false))).toEqual(compile(query))
  expect(compile(query.use(maybeWithName, true))).toMatchObject({
    text: 'SELECT "form"."name" AS "name" FROM "form" AS "form"',
    parameters: [],
    fields: [{ key: "name", type: t.text }],
  })
})

it("selects the relations of the query it is applied to", () => {
  const field = defineTable("field", {
    formId: t.uuid,
  })
  const forms = defineSchema({ form, field }).$relations({
    form: {
      fields: many(field, { from: "id", to: "formId" }),
    },
  })
  const withFields = defineHelper(forms.form, form =>
    form.select(columns => ({
      fields: columns.fields,
    })),
  )
  const db = bindSchema(
    defineSchema(forms, { owner: defineTable("owner", { id: t.uuid }) }),
    createDatabase({ driver: createRecordingDriver().driver }),
  )

  expect(db.$compile(db.form.use(withFields)).text).toContain(
    'FROM "field" AS "field" WHERE "field"."formId" = "form"."id"',
  )
})

it("keeps the Db of the query it is applied to", () => {
  const db = bindSchema(schema, createDatabase({ driver: createRecordingDriver().driver }))
  const ofDb = defineHelper(db.form, form => form.select("name"))

  expect(db.form.use(ofDb).db).toBe(db)
  expect(ofDb(schema.form).db).toBeUndefined()
})

it("rejects a result that does not derive from the query, even when called directly", () => {
  // @ts-expect-error A helper returns the query it receives or one derived from it.
  const unrelated = defineHelper(schema.form, () => schema.form)

  expect(() => unrelated(schema.form)).toThrow(
    "The callback of a helper must return the query it receives or one derived from it",
  )
})
