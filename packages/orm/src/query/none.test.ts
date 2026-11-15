import { describe, expect, it } from "bun:test"

import { describePostgres } from "../../testing/postgres"
import { bindSchema } from "../execution/db"
import { count, sum } from "../expression/aggregates"
import { sql } from "../expression/sql"
import { many } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { AnyMutationQuery } from "./mutation"
import { isNoneStatement } from "./none"
import type { AnySelectQuery } from "./select"

const form = defineTable("form", {
  id: t.integer.primaryKey(),
  name: t.text,
})

const field = defineTable("form_field", {
  id: t.integer.primaryKey(),
  formId: t.integer.columnName("form_id"),
  position: t.integer,
})

const schema = defineSchema({ form, field }).$relations({
  form: {
    fields: many(field, { from: "id", to: "formId" }),
  },
})

/** Tells whether a `Db` resolves `query` without running its statement. */
function skips(query: AnySelectQuery | AnyMutationQuery): boolean {
  return isNoneStatement(query.node)
}

describe("isNoneStatement", () => {
  it("takes a query of rows of none, with its fields, nested rows, and order", () => {
    expect(skips(schema.form.none())).toBe(true)
    expect(
      skips(
        schema.form
          .none()
          .select(form => ({
            id: form.id,
            fields: form.fields.select("position"),
            fieldCount: form.fields.count(),
            positions: form.fields.sum(field => field.position),
          }))
          .orderBy("name"),
      ),
    ).toBe(true)
  })

  it("rejects a query without none, also of a filter of FALSE", () => {
    expect(skips(schema.form)).toBe(false)
    expect(skips(schema.form.where(form => form.id.in([])))).toBe(false)
  })

  it("rejects an aggregate query and a query of exists, whose statements return one row", () => {
    expect(skips(schema.form.none().count())).toBe(false)
    expect(skips(schema.form.none().exists())).toBe(false)
    expect(skips(schema.form.groupBy("name").none().count())).toBe(false)
  })

  it("rejects a query without groups that may aggregate its rows, in a field, a sort key, or a SQL fragment", () => {
    expect(
      skips(
        schema.form.none().select(() => ({
          total: count(),
        })),
      ),
    ).toBe(false)
    expect(skips(schema.form.none().orderBy(() => count()))).toBe(false)
    expect(
      skips(
        schema.form.none().select(() => ({
          total: sql(t.integer)`count(*)`,
        })),
      ),
    ).toBe(false)
  })

  it("rejects a query whose nested query aggregates a column of its rows, which PostgreSQL assigns to it, also in a fallback of coalesce and a field that distinct keeps", () => {
    const queries = [
      schema.form.none().select(form => ({
        total: schema.field.take().get(() => sum(form.id)),
      })),
      schema.form.none().select(form => ({
        total: schema.field.sum("position").coalesce(sum(form.id)),
      })),
      schema.form.none().select(form => ({
        total: schema.field
          .select(() => ({
            total: sum(form.id),
          }))
          .distinct()
          .count(),
      })),
    ]

    expect(queries.map(skips)).toEqual([false, false, false])
  })

  it("takes a query of groups, which has no group without rows", () => {
    const query = schema.form
      .none()
      .groupBy("name")
      .select(() => ({
        total: count(),
      }))

    expect(skips(query)).toBe(true)
  })

  it("takes an update and a delete of none, unless their fields may aggregate", () => {
    expect(skips(schema.form.none().update({ name: "Survey" }))).toBe(true)
    expect(skips(schema.form.none().delete().select("id"))).toBe(true)
    expect(
      skips(
        schema.form
          .none()
          .update({})
          .select(() => ({
            total: count(),
          })),
      ),
    ).toBe(false)
    expect(skips(schema.form.where({ id: 1 }).delete())).toBe(false)
  })
})

describePostgres("in PostgreSQL", ({ database, testTransaction, useTestFixture }) => {
  useTestFixture(() =>
    database.script(`
      CREATE SCHEMA none_test;
      CREATE TABLE none_test.form (id integer, name text);
      CREATE TABLE none_test.form_field (id integer, form_id integer, position integer);
      INSERT INTO none_test.form VALUES (1, 'Survey');
      INSERT INTO none_test.form_field VALUES (1, 1, 1);
    `),
  )

  const db = bindSchema(schema, database, { schemaName: "none_test" })

  it("gives no row by the statement of a query that it takes, and one row by that of a query that it rejects", async () => {
    const queries = [
      schema.form.none().select(form => ({
        id: form.id,
        fieldCount: form.fields.count(),
      })),
      schema.form
        .none()
        .groupBy("name")
        .select(() => ({
          total: count(),
        })),
      schema.form.none().select(() => ({
        total: count(),
      })),
      schema.form.none().orderBy(() => count()),
      schema.form.none().select(form => ({
        total: schema.field.take().get(() => sum(form.id)),
      })),
      schema.form.none().select(form => ({
        total: schema.field.sum("position").coalesce(sum(form.id)),
      })),
      schema.form.none().select(form => ({
        total: schema.field
          .select(() => ({
            total: sum(form.id),
          }))
          .distinct()
          .count(),
      })),
    ]

    for (const query of queries) {
      const { rows } = await testTransaction(() => database.execute(db.$compile(query)))
      expect({ text: query.toSQL().text, rows: rows.length }).toEqual({
        text: query.toSQL().text,
        rows: skips(query) ? 0 : 1,
      })
    }
  })
})
