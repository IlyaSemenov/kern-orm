import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import { getThrownError } from "@kern-orm/test-harness/errors"
import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"
import { createDatabase } from "kern-db"
import { waitForLockedStatement } from "kern-db/testing"

import {
  describePooledPostgres,
  describePostgres,
  startWaiting,
  whileHolding,
} from "../../testing/postgres"
import { bindSchema } from "../execution/db"
import { param, sql } from "../expression/sql"
import { many } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { createComment } from "./comment"

const form = defineTable("form", {
  id: t.integer.primaryKey(),
  name: t.text,
})

const field = defineTable("form_field", {
  id: t.integer.primaryKey(),
  formId: t.integer.columnName("form_id"),
})

const schema = defineSchema({ form, field }).$relations({
  form: {
    fields: many(field, { from: "id", to: "formId" }),
  },
})

describe("createComment", () => {
  it("takes a label that stays inside the comment, also one that ends with `*`, `/`, or `-`", () => {
    for (const label of ["forms:claim", "", "a*", "a/", "a-", "a $1 ?", "line\nbreak"]) {
      expect(createComment(label)).toBe(label)
    }
  })

  it("takes null, which removes the comment", () => {
    expect(createComment(null)).toBeUndefined()
  })

  it("rejects the start and the end of a block comment, and a NUL character", () => {
    // TypeORM removes "*/" in one pass, so "**//" gives "*/", and keeps "/*": https://github.com/typeorm/typeorm/blob/1.1.3/packages/typeorm/src/query-builder/QueryBuilder.ts#L841-L852
    expect(getThrownError(() => createComment("a */ b"))).toEqual(
      new TypeError('comment cannot contain "/*" or "*/": "a */ b"'),
    )
    expect(getThrownError(() => createComment("a /* b"))).toEqual(
      new TypeError('comment cannot contain "/*" or "*/": "a /* b"'),
    )
    expect(getThrownError(() => createComment("a\0b"))).toEqual(
      new TypeError("comment cannot contain a NUL character"),
    )
  })

  it("rejects a value other than a string or null, such as undefined or an array", () => {
    for (const label of [undefined, ["*/"], 1]) {
      expect(getThrownError(() => createComment(label))).toEqual(
        new TypeError("comment takes a string, or null to remove the comment"),
      )
    }
  })
})

describe("the comment of a statement", () => {
  const forms = schema.form.select("id")
  const text = 'SELECT "form"."id" AS "id" FROM "form" AS "form"'

  it("starts the SQL of the statement of a query", () => {
    expect(forms.comment("forms:list").toSQL()).toEqual({
      text: `/* forms:list */ ${text}`,
      parameters: [],
    })
  })

  it("replaces an earlier comment, is removed by null rather than by an empty label, and leaves the query it derives from unchanged", () => {
    const listed = forms.comment("forms:list")

    expect(listed.comment("forms:page").toSQL().text).toBe(`/* forms:page */ ${text}`)
    expect(listed.comment(null).toSQL().text).toBe(text)
    expect(listed.comment("").toSQL().text).toBe(`/*  */ ${text}`)
    expect(listed.toSQL().text).toBe(`/* forms:list */ ${text}`)
    expect(forms.toSQL().text).toBe(text)
  })

  it("rejects a label that would leave the comment, in the method of each query", () => {
    const rejection = new TypeError('comment cannot contain "/*" or "*/": "*/"')

    expect(getThrownError(() => forms.comment("*/"))).toEqual(rejection)
    expect(getThrownError(() => forms.transform(rows => rows).comment("*/"))).toEqual(rejection)
    expect(getThrownError(() => schema.$select({ n: sql(t.integer)`1` }).comment("*/"))).toEqual(
      rejection,
    )
    expect(getThrownError(() => schema.form.find(1).delete().comment("*/"))).toEqual(rejection)
  })

  it("stays through the queries derived from a select query", () => {
    const commented = schema.form.comment("forms")

    expect(commented.select("id").take().optional().toSQL().text).toBe(
      `/* forms */ ${text} LIMIT 1`,
    )
    expect(commented.count().toSQL().text).toBe(
      '/* forms */ SELECT count(*) AS "count" FROM "form" AS "form"',
    )
    expect(commented.exists().toSQL().text).toBe(
      '/* forms */ SELECT EXISTS (SELECT FROM "form" AS "form") AS "exists"',
    )
    expect(
      commented
        .select("id")
        .map(({ id }) => id)
        .toSQL().text,
    ).toBe(`/* forms */ ${text}`)
    expect(
      commented
        .select("id")
        .transform(rows => rows.length)
        .toSQL().text,
    ).toBe(`/* forms */ ${text}`)
  })

  it("comments a query of transform and of $select", () => {
    expect(
      forms
        .transform(rows => rows.length)
        .comment("forms:count")
        .toSQL().text,
    ).toBe(`/* forms:count */ ${text}`)
    expect(
      schema
        .$select({
          number: sql(t.integer)`1`,
        })
        .comment("number")
        .toSQL().text,
    ).toBe('/* number */ SELECT 1 AS "number"')
  })

  it("stays through the mutations of a select query, after find and on the table", () => {
    const found = schema.form.find(1).comment("forms:save")

    expect(found.update({ name: "a" }).select("id").toSQL().text).toBe(
      '/* forms:save */ UPDATE "form" AS "form" SET "name" = $1 WHERE "form"."id" = $2 RETURNING "form"."id" AS "id"',
    )
    expect(found.delete().toSQL().text).toBe(
      '/* forms:save */ DELETE FROM "form" AS "form" WHERE "form"."id" = $1',
    )
    expect(found.upsert({ name: "a" }).toSQL().text).toBe(
      '/* forms:save */ INSERT INTO "form" AS "form" ("id", "name") VALUES ($1, $2) ON CONFLICT ("id") DO UPDATE SET "name" = "excluded"."name"',
    )

    const inserted = schema.form.comment("forms:add").insert({ id: 1, name: "a" })
    const insert = 'INSERT INTO "form" AS "form" ("id", "name") VALUES ($1, $2)'
    expect(inserted.toSQL().text).toBe(`/* forms:add */ ${insert}`)
    expect(inserted.onConflict("id").doNothing().toSQL().text).toBe(
      `/* forms:add */ ${insert} ON CONFLICT ("id") DO NOTHING`,
    )
  })

  it("comments a mutation, through its selection, its conversion, and its action of onConflict", () => {
    // knex leaves out the comment of an insert, an update, and a delete on PostgreSQL: https://github.com/knex/knex/blob/3.3.0/lib/dialects/postgres/query/pg-querycompiler.js#L29-L90
    const insert = 'INSERT INTO "form" AS "form" ("id", "name") VALUES ($1, $2)'
    const inserted = schema.form.insert({ id: 1, name: "a" })

    expect(inserted.comment("forms:add").get("id").map(String).toSQL().text).toBe(
      `/* forms:add */ ${insert} RETURNING "form"."id" AS "id"`,
    )
    expect(inserted.comment("forms:add").onConflict("id").doNothing().toSQL().text).toBe(
      `/* forms:add */ ${insert} ON CONFLICT ("id") DO NOTHING`,
    )
    expect(inserted.onConflict("id").doNothing().comment("forms:add").toSQL().text).toBe(
      `/* forms:add */ ${insert} ON CONFLICT ("id") DO NOTHING`,
    )
  })

  it("leaves out the comment of a nested query", () => {
    const owners = schema.field.comment("fields").distinct().pluck("formId")
    const subquery =
      'SELECT DISTINCT "form_field"."form_id" AS "formId" FROM "form_field" AS "form_field"'

    expect(owners.toSQL().text).toBe(`/* fields */ ${subquery}`)
    expect(
      schema.form
        .where(form => form.id.in(owners))
        .comment("forms")
        .toSQL().text,
    ).toBe(`/* forms */ SELECT FROM "form" AS "form" WHERE "form"."id" IN (${subquery})`)
    expect(
      schema.form
        .select(form => ({
          fields: form.fields.comment("fields").count(),
        }))
        .toSQL().text,
    ).toBe(
      'SELECT (SELECT count(*) AS "count" FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id") AS "fields" FROM "form" AS "form"',
    )
    expect(
      schema.form.insert({ id: 1, name: schema.form.comment("names").find(2).get("name") }).toSQL()
        .text,
    ).toBe(
      'INSERT INTO "form" AS "form" ("id", "name") VALUES ($1, (SELECT "form_2"."name" AS "name" FROM "form" AS "form_2" WHERE "form_2"."id" = $2))',
    )

    const db = bindSchema(schema, createDatabase({ driver: createRecordingDriver().driver }))
    expect(db.$query`SELECT ${owners}`.toSQL().text).toBe(`SELECT (${subquery})`)
  })

  it("starts the statement of a bound query, which its Db compiles and runs", async () => {
    const { driver, statements } = createRecordingDriver()
    const db = bindSchema(schema, createDatabase({ driver }))
    const query = db.form.select("id").comment("forms:list")

    expect(query.toSQL().text).toBe(`/* forms:list */ ${text}`)
    expect(db.$compile(forms.comment("forms:list")).text).toBe(`/* forms:list */ ${text}`)
    await query
    expect(statements.map(statement => statement.text)).toEqual([`/* forms:list */ ${text}`])
  })
})

describePostgres("in PostgreSQL", ({ database, testTransaction }) => {
  const db = bindSchema(schema, database)

  it("keeps the parameters of a statement whose comment contains a placeholder", () =>
    testTransaction(async () => {
      expect(
        await db
          .$select({
            value: param(t.text, "value"),
          })
          .comment("value $1 ?"),
      ).toEqual({ value: "value" })
    }))
})

describePooledPostgres("in the activity of PostgreSQL", ({ database }) => {
  const db = bindSchema(schema, database, { schemaName: "comment_test" })

  // The lock timeout fails a test that a transaction left open rather than hanging the others.
  beforeEach(() =>
    database.script(`
      SET LOCAL client_min_messages = warning;
      SET LOCAL lock_timeout = '5s';
      DROP SCHEMA IF EXISTS comment_test CASCADE;
      CREATE SCHEMA comment_test;
      CREATE TABLE comment_test.form (id integer PRIMARY KEY, name text NOT NULL);
      INSERT INTO comment_test.form VALUES (1, 'Survey');
    `),
  )
  afterEach(() =>
    database.script(`
      SET LOCAL client_min_messages = warning;
      SET LOCAL lock_timeout = '5s';
      DROP SCHEMA comment_test CASCADE;
    `),
  )

  it("finds the statement that waits for a lock by its comment", () =>
    whileHolding(
      db,
      () => db.form.find(1).forUpdate(),
      async (_, commit) => {
        const waiting = await startWaiting(db, () =>
          db.form.find(1).select("id").forUpdate().comment("forms:claim"),
        )
        try {
          expect(await waitForLockedStatement(database, "/* forms:claim */")).toBe(waiting.pid)
        } finally {
          await commit()
          await waiting.result
        }
      },
    ))
})
