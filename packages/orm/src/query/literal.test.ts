import { describe, expect, it } from "bun:test"

import { createRecordingDriver } from "../../testing/database/recording-driver"
import { describePostgres } from "../../testing/postgres"
import { createDatabase } from "../database/database"
import { bindSchema } from "../execution/db"
import { coalesce } from "../expression/functions"
import { and } from "../expression/predicates"
import { param, sql } from "../expression/sql"
import { many, one } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { literal } from "./literal"
import { from } from "./select"

const form = defineTable("form", {
  id: t.integer.primaryKey(),
  name: t.text,
})

const field = defineTable("field", {
  id: t.integer.primaryKey(),
  formId: t.integer.columnName("form_id"),
  label: t.text,
})

const schema = defineSchema({ form, field }).$relations({
  form: {
    fields: many(field, { from: "id", to: "formId" }),
  },
  field: {
    form: one(form, { from: "formId", to: "id", required: true }),
  },
})

/** Creates a `Db` whose driver answers every statement with `rows`. */
function createDb(rows: readonly (readonly (string | null)[])[]) {
  const { driver, statements } = createRecordingDriver({ respond: () => ({ rows }) })
  return { db: bindSchema(schema, createDatabase({ driver })), statements }
}

describe("selecting", () => {
  it("leaves a literal out of the statement", () => {
    const query = from(form).select(columns => ({
      id: columns.id,
      note: literal("none"),
    }))

    const { text, parameters } = query.toSQL()
    expect(text).toBe('SELECT "form"."id" AS "id" FROM "form" AS "form"')
    expect(parameters).toEqual([])
  })

  it("returns the value itself in every record, whatever it is", async () => {
    const value = new Map([[1, new Date(0)]])
    const { db } = createDb([["1"], ["2"]])

    const records = await db.form.select(columns => ({
      id: columns.id,
      value: literal(value),
      missing: literal(undefined),
      fn: literal(createDb),
    }))

    expect(records).toEqual([
      { id: 1, value, missing: undefined, fn: createDb },
      { id: 2, value, missing: undefined, fn: createDb },
    ])
    expect(records[1]!.value).toBe(value)
    expect(Object.keys(records[0]!)).toEqual(["id", "value", "missing", "fn"])
  })

  it("keeps the fields in the order of the selection", async () => {
    const { db } = createDb([["1", "Survey"]])

    const record = await db.form
      .select(columns => ({
        first: literal(1),
        id: columns.id,
        second: literal(2),
        name: columns.name,
        third: literal(3),
      }))
      .take()

    expect(Object.keys(record)).toEqual(["first", "id", "second", "name", "third"])
    expect(record).toEqual({ first: 1, id: 1, second: 2, name: "Survey", third: 3 })
  })

  it("replaces a field by key in both directions, in place", async () => {
    const { db } = createDb([["Survey"]])

    const record = await db.form
      .select(() => ({
        name: literal("none"),
        note: literal("first"),
      }))
      .select(columns => ({
        name: columns.name,
        note: literal("second"),
      }))
      .take()

    expect(record).toEqual({ name: "Survey", note: "second" })

    const query = from(form)
      .select("id", "name")
      .select(() => ({
        id: literal(0),
      }))
    expect(query.toSQL().text).toBe('SELECT "form"."name" AS "name" FROM "form" AS "form"')
  })

  it("gives records of literals for the rows of a statement without fields", async () => {
    const { db, statements } = createDb([[], []])

    const records = await db.form.select(() => ({
      note: literal("none"),
    }))

    expect(records).toEqual([{ note: "none" }, { note: "none" }])
    expect(statements[0]!.text).toBe('SELECT FROM "form" AS "form"')
  })

  it("is dropped by clearSelect and by queries of values", () => {
    const query = from(form).select(() => ({
      note: literal("none"),
    }))

    expect(query.clearSelect().select("id").toSQL().text).toBe(
      'SELECT "form"."id" AS "id" FROM "form" AS "form"',
    )
    expect(query.pluck("id").toSQL().text).toBe('SELECT "form"."id" AS "id" FROM "form" AS "form"')
  })

  it("selects a literal instead of a nested query", () => {
    const query = schema.form.select(columns => ({
      id: columns.id,
      fields: literal([]),
    }))

    expect(query.toSQL().text).toBe('SELECT "form"."id" AS "id" FROM "form" AS "form"')
  })

  it("sorts by the position of a projection among the fields of the statement", () => {
    const query = schema.form
      .select(columns => ({
        note: literal("none"),
        id: columns.id,
        name: columns.name,
      }))
      .orderBy("name")

    expect(query.toSQL().text).toBe(
      'SELECT "form"."id" AS "id", "form"."name" AS "name" FROM "form" AS "form" ORDER BY 2',
    )
  })

  it("keeps a literal beside nested queries of a page after an offset", async () => {
    const { db, statements } = createDb([["1", "[]"]])

    const records = await db.form
      .select(columns => ({
        note: literal("none"),
        id: columns.id,
        fields: columns.fields.select("id"),
      }))
      .orderBy("id")
      .offset(1)

    expect(records).toEqual([{ note: "none", id: 1, fields: [] }])
    expect(statements[0]!.text).toEndWith(
      'FROM (SELECT "form_2"."id" AS "id" FROM "form" AS "form_2" ORDER BY 1 OFFSET $1) AS "form" ORDER BY "form"."id"',
    )
  })

  it("sorts by a field selected under a condition only under that condition", () => {
    const selectName = (withName: boolean) =>
      from(form)
        .select(columns => ({
          id: columns.id,
          name: withName ? columns.name : literal(null),
        }))
        .orderBy((_columns, selected) => (withName ? selected.name : []))

    expect(selectName(true).toSQL().text).toBe(
      'SELECT "form"."id" AS "id", "form"."name" AS "name" FROM "form" AS "form" ORDER BY 2',
    )
    expect(selectName(false).toSQL().text).toBe('SELECT "form"."id" AS "id" FROM "form" AS "form"')
  })

  it("rejects sorting by a literal", () => {
    expect(() =>
      from(form)
        .select(() => ({
          note: literal("none"),
        }))
        .orderBy((_columns, selected) => selected.note),
    ).toThrow('Field "note" holds a literal and cannot be sorted by')
  })
})

describe("beyond a selection", () => {
  const value = literal(1)

  it("rejects a literal as an operand or a value", () => {
    const message = "A literal is only a selected field"

    expect(() => from(form).where({ id: value as never })).toThrow(message)
    expect(() => from(form).where(columns => columns.id.eq(value as never))).toThrow(message)
    expect(() => from(form).where(and(value as never))).toThrow(message)
    expect(() =>
      from(form).select(columns => ({ id: coalesce(columns.id, value as never) })),
    ).toThrow(message)
    expect(() => param(t.integer, value as never)).toThrow(message)
    expect(() => sql`${value}`).toThrow(message)
    expect(() => schema.form.insert({ id: 1, name: value as never })).toThrow(message)
  })

  it("rejects a literal as the value of get and pluck", () => {
    expect(() => from(form).get(() => value as never)).toThrow(
      "The callback of get must return an expression",
    )
    expect(() => from(form).pluck(() => value as never)).toThrow(
      "The callback of pluck must return an expression",
    )
  })
})

describePostgres("in PostgreSQL", ({ database, testTransaction }) => {
  const db = bindSchema(schema, database)

  /** Runs `body` in a transaction with a form and its fields. */
  function withForms<T>(body: () => Promise<T>): Promise<T> {
    return testTransaction(async () => {
      await db.$query`CREATE TEMP TABLE form (id integer PRIMARY KEY, name text NOT NULL) ON COMMIT DROP`
      await db.$query`CREATE TEMP TABLE field (id integer PRIMARY KEY, form_id integer NOT NULL, label text NOT NULL) ON COMMIT DROP`
      await db.$query`INSERT INTO form VALUES (1, 'Survey'), (2, 'Feedback')`
      await db.$query`INSERT INTO field VALUES (1, 1, 'Age'), (2, 1, 'City')`
      return await body()
    })
  }

  it("mixes literals with columns and nested rows at any depth", async () => {
    const value = { nested: [new Date(0)] }

    const records = await withForms(
      async () =>
        await db.form
          .select(columns => ({
            id: columns.id,
            note: literal(value),
            fields: columns.fields.orderBy("id").select(fieldColumns => ({
              before: literal("before"),
              id: fieldColumns.id,
              after: literal("after"),
            })),
          }))
          .orderBy("id"),
    )

    expect(records).toEqual([
      {
        id: 1,
        note: value,
        fields: [
          { before: "before", id: 1, after: "after" },
          { before: "before", id: 2, after: "after" },
        ],
      },
      { id: 2, note: value, fields: [] },
    ])
    expect(records[0]!.note).toBe(value)
  })

  it("gives a record of only literals for each row of the query", async () => {
    const selectNote = () =>
      db.form.select(() => ({
        note: literal("form"),
      }))

    const result = await withForms(async () => ({
      all: await selectNote(),
      none: await selectNote().where({ id: 3 }),
      one: await selectNote().take(),
      found: await selectNote().where({ id: 1 }).take().optional(),
      missing: await selectNote().where({ id: 3 }).take().optional(),
    }))

    expect(result).toStrictEqual({
      all: [{ note: "form" }, { note: "form" }],
      none: [],
      one: { note: "form" },
      found: { note: "form" },
      missing: undefined,
    })
  })

  it("gives records of only literals of nested rows", async () => {
    const result = await withForms(
      async () =>
        await db.form.find(1).select(columns => ({
          note: literal("form"),
          fields: columns.fields.select(() => ({
            note: literal("field"),
          })),
        })),
    )

    expect(result).toEqual({
      note: "form",
      fields: [{ note: "field" }, { note: "field" }],
    })
  })

  it("gives a literal in a page after an offset", async () => {
    const records = await withForms(
      async () =>
        await db.form
          .select(columns => ({
            note: literal("none"),
            id: columns.id,
            fieldCount: columns.fields.count(),
            fields: columns.fields.select("id"),
          }))
          .orderBy("id")
          .offset(1),
    )

    expect(records).toEqual([{ note: "none", id: 2, fieldCount: 0, fields: [] }])
  })

  it("selects literals in $select without a statement field for them", async () => {
    const page = await withForms(
      async () =>
        await db.$select({
          note: literal("none"),
          formCount: db.form.count(),
        }),
    )
    expect(page).toEqual({ note: "none", formCount: 2 })

    expect(
      await testTransaction(
        async () =>
          await db.$select({
            note: literal("none"),
          }),
      ),
    ).toEqual({ note: "none" })
  })

  it("returns literals from a mutation, also without fields of RETURNING", async () => {
    const result = await withForms(async () => ({
      inserted: await db.form.insert({ id: 3, name: "Poll" }).select(columns => ({
        id: columns.id,
        note: literal("inserted"),
      })),
      updated: await db.form
        .where({ id: 1 })
        .update({ name: "Quiz" })
        .select(() => ({
          note: literal("updated"),
        })),
      deleted: await db.form
        .find(2)
        .delete()
        .select(() => ({
          note: literal("deleted"),
        })),
    }))

    expect(result).toEqual({
      inserted: { id: 3, note: "inserted" },
      updated: [{ note: "updated" }],
      deleted: { note: "deleted" },
    })
  })
})
