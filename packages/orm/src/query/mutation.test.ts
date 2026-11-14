import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"
import { createDatabase, NotFoundError } from "kern-db"

import {
  describePooledPostgres,
  describePostgres,
  startWaiting,
  whileHolding,
} from "../../testing/postgres"
import { bindSchema } from "../execution/db"
import { coalesce } from "../expression/functions"
import { sql } from "../expression/sql"
import { many, one } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { defineHelper } from "./helper"
import type { AnyMutationQuery } from "./mutation"
import { defineExpression } from "./reusable-expression"
import type { AnySelectQuery } from "./select"
import { from } from "./select"

const form = defineTable("form", {
  id: t.integer.primaryKey().hasDefault(),
  name: t.text,
  note: t.text.nullable(),
})

const field = defineTable("form_field", {
  id: t.integer.primaryKey().hasDefault(),
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

const vote = defineTable(
  "vote",
  {
    id: t.integer.primaryKey().hasDefault(),
    formId: t.integer.columnName("form_id"),
    userId: t.integer.columnName("user_id"),
    votes: t.integer,
    note: t.text.nullable(),
  },
  { unique: [["formId", "userId"]] },
)

const license = defineTable(
  "license",
  {
    id: t.integer.primaryKey().hasDefault(),
    token: t.text,
    note: t.text.nullable(),
  },
  { singleton: true },
)

/** Binds the schema to a database whose driver answers every statement with `rows`, reporting `count` rows. */
function connect(count: number, rows: string[][] = []) {
  const { driver, statements } = createRecordingDriver({ respond: () => ({ count, rows }) })
  return { db: bindSchema(schema, createDatabase({ driver }), { schemaName: "app" }), statements }
}

describe("insert", () => {
  it("inserts the values of a record, returning the number of the rows", () => {
    expect(schema.form.insert({ name: "Survey", note: null }).toSQL({ schemaName: "app" })).toEqual(
      {
        text: 'INSERT INTO "app"."form" AS "form" ("name", "note") VALUES ($1, $2)',
        parameters: ["Survey", null],
      },
    )
  })

  it("inserts records in one statement, with DEFAULT for a column that a record omits", () => {
    const query = schema.form.insertMany([{ name: "Survey" }, { name: "Feedback", id: 5 }])

    expect(query.toSQL()).toEqual({
      text: 'INSERT INTO "form" AS "form" ("name", "id") VALUES ($1, DEFAULT), ($2, $3)',
      parameters: ["Survey", "Feedback", "5"],
    })
  })

  it("takes an expression as a value", () => {
    expect(schema.form.insert({ name: sql<string>`upper(${"survey"})` }).toSQL().text).toBe(
      'INSERT INTO "form" AS "form" ("name") VALUES (upper($1))',
    )
  })

  it("rejects a query with clauses and an array that insertMany does not take", () => {
    const message =
      "insert applies only to a query of a table without clauses, such as filters or selected fields; select the fields that it returns after it"

    for (const query of [
      schema.form.where({ name: "Survey" }),
      schema.form.where({}),
      schema.form.select("id"),
      schema.form.orderBy("id"),
      schema.form.groupBy("id"),
      schema.form.limit(1),
      schema.form.distinct(),
      schema.form.forUpdate(),
      schema.form.take(),
      schema.form.all(),
    ] as AnySelectQuery[]) {
      expect(() => query.insert({ name: "Survey" })).toThrow(message)
    }
    expect(() => schema.form.insertMany({ name: "Survey" } as never)).toThrow(
      "insertMany takes an array of records",
    )
  })

  it("inserts the row of a singleton table, but not several rows", () => {
    expect(from(license).insert({ token: "Token" }).toSQL().text).toBe(
      'INSERT INTO "license" AS "license" ("token") VALUES ($1)',
    )
    // @ts-expect-error A singleton table.
    expect(() => from(license).insertMany([{ token: "Token" }])).toThrow(
      'insertMany cannot insert into singleton table "license", which holds one row; use insert or upsert',
    )
  })
})

describe("conflicts", () => {
  const record = { formId: 1, userId: 2, votes: 3 }

  it("skip the rows that conflict on a key, named in its order, or on any key", () => {
    expect(from(vote).insert(record).onConflict("userId", "formId").doNothing().toSQL()).toEqual({
      text: 'INSERT INTO "vote" AS "vote" ("form_id", "user_id", "votes") VALUES ($1, $2, $3) ON CONFLICT ("form_id", "user_id") DO NOTHING',
      parameters: ["1", "2", "3"],
    })
    expect(from(vote).insertMany([record]).onConflict().doNothing().toSQL().text).toBe(
      'INSERT INTO "vote" AS "vote" ("form_id", "user_id", "votes") VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    )
  })

  it("make the row of insert optional, keep the rows of insertMany, and return fields after the conflict", () => {
    const inserted = from(vote).insert(record).onConflict("id").doNothing()

    expect(inserted.node).toMatchObject({ rows: "optional", value: false })
    expect(inserted.get("id").node).toMatchObject({ rows: "optional", value: true })
    expect(from(vote).insertMany([record]).onConflict("id").doNothing().node.rows).toBe("many")
    expect(inserted.select("id").toSQL().text).toBe(
      'INSERT INTO "vote" AS "vote" ("form_id", "user_id", "votes") VALUES ($1, $2, $3) ON CONFLICT ("id") DO NOTHING RETURNING "vote"."id" AS "id"',
    )
  })

  it("update the existing record with the inserted values of the columns of merge, or of every column apart from the key", () => {
    const merged = from(vote)
      .insertMany([record, { formId: 2, userId: 2, votes: 1 }])
      .onConflict("userId", "formId")
      .merge("votes")

    expect(merged.toSQL().text).toBe(
      'INSERT INTO "vote" AS "vote" ("form_id", "user_id", "votes") VALUES ($1, $2, $3), ($4, $5, $6) ON CONFLICT ("form_id", "user_id") DO UPDATE SET "votes" = "excluded"."votes"',
    )
    expect(merged.node.rows).toBe("many")
    expect(from(vote).insert(record).onConflict("id").merge().toSQL().text).toBe(
      'INSERT INTO "vote" AS "vote" ("form_id", "user_id", "votes") VALUES ($1, $2, $3) ON CONFLICT ("id") DO UPDATE SET "form_id" = "excluded"."form_id", "user_id" = "excluded"."user_id", "votes" = "excluded"."votes"',
    )
  })

  it("update the existing record with the values of update, which see it and the inserted row as excluded", () => {
    const updated = from(vote)
      .insert(record)
      .onConflict("formId", "userId")
      .update((existing, excluded) => ({
        votes: sql(t.integer)`${existing.votes} + ${excluded.votes}`,
        note: null,
      }))

    expect(updated.toSQL()).toEqual({
      text: 'INSERT INTO "vote" AS "vote" ("form_id", "user_id", "votes") VALUES ($1, $2, $3) ON CONFLICT ("form_id", "user_id") DO UPDATE SET "votes" = "vote"."votes" + "excluded"."votes", "note" = $4',
      parameters: ["1", "2", "3", null],
    })
    expect(updated.node.rows).toBe("one")
    expect(from(vote).insert(record).onConflict("id").update({ votes: 0 }).toSQL().text).toBe(
      'INSERT INTO "vote" AS "vote" ("form_id", "user_id", "votes") VALUES ($1, $2, $3) ON CONFLICT ("id") DO UPDATE SET "votes" = $4',
    )
  })

  it("rejects merge of a column that a record does not give, of the key, or twice, and without a column", () => {
    const inserted = from(vote)
      .insertMany([{ ...record, note: "Note" }, record])
      .onConflict("id")
    const missing = (key: string) =>
      `merge cannot set "${key}", which a record does not give, so that its default would replace the value of the record; give it in every record or leave it out of merge`

    expect(() => inserted.merge("note")).toThrow(missing("note"))
    expect(() => inserted.merge()).toThrow(missing("note"))
    expect(() => from(vote).insert(record).onConflict("id").merge("note")).toThrow(missing("note"))
    // @ts-expect-error A column of the key.
    expect(() => inserted.merge("id")).toThrow(
      'merge cannot set "id", a column of the key of onConflict',
    )
    expect(() => inserted.merge("votes", "votes")).toThrow(
      'merge takes each column once, not "votes" twice',
    )
    expect(() =>
      from(vote)
        .insert({ formId: 1, userId: 2 } as never)
        .onConflict("formId", "userId")
        .merge(),
    ).toThrow(
      "merge has no column to set, since the insert gives no column apart from the key of onConflict; use doNothing",
    )
  })

  it("rejects update without a column to set", () => {
    expect(() => from(vote).insert(record).onConflict("id").update({ note: undefined })).toThrow(
      'update of onConflict takes the value of at least one column of table "vote"; to skip the rows that conflict, use doNothing()',
    )
  })

  it("rejects merge and update of a conflict on any key", () => {
    const anyKey = from(vote).insert(record).onConflict()

    // @ts-expect-error A conflict on any key.
    expect(() => anyKey.merge()).toThrow(
      "merge needs the columns of a key in onConflict, since PostgreSQL updates a record only on a conflict of a named key",
    )
    // @ts-expect-error A conflict on any key.
    expect(() => anyKey.update({ votes: 0 })).toThrow(
      "update needs the columns of a key in onConflict",
    )
  })

  it("update the row of a singleton table without columns, and skip a row that conflicts on any key", () => {
    const inserted = from(license).insert({ token: "Token" })

    expect(inserted.onConflict().merge().toSQL().text).toBe(
      'INSERT INTO "license" AS "license" ("token") VALUES ($1) ON CONFLICT ((true)) DO UPDATE SET "token" = "excluded"."token"',
    )
    expect(inserted.onConflict().update({ note: "Note" }).toSQL().text).toBe(
      'INSERT INTO "license" AS "license" ("token") VALUES ($1) ON CONFLICT ((true)) DO UPDATE SET "note" = $2',
    )
    expect(inserted.onConflict().doNothing().toSQL().text).toBe(
      'INSERT INTO "license" AS "license" ("token") VALUES ($1) ON CONFLICT DO NOTHING',
    )
    expect(inserted.onConflict("id").merge().toSQL().text).toBe(
      'INSERT INTO "license" AS "license" ("token") VALUES ($1) ON CONFLICT ("id") DO UPDATE SET "token" = "excluded"."token"',
    )
  })

  it("applies only right after insert or insertMany, once", () => {
    const inserted: AnyMutationQuery = from(vote).insert(record)
    const message =
      "onConflict applies right after insert or insertMany, once; call select, get, pluck, map, and transform after its action"

    for (const mutation of [
      from(vote).find(1).update({ votes: 1 }),
      from(vote).find(1).delete(),
    ] as AnyMutationQuery[]) {
      expect(() => mutation.onConflict()).toThrow(
        "onConflict applies only to insert and insertMany",
      )
    }
    for (const mutation of [
      inserted.select("id"),
      inserted.get("id"),
      inserted.transform(count => count),
      inserted.onConflict().doNothing(),
      inserted.onConflict("id").merge("votes"),
    ] as AnyMutationQuery[]) {
      expect(() => mutation.onConflict()).toThrow(message)
    }
  })

  it("leaves the insert it derives from unchanged", () => {
    const inserted = from(vote).insert(record)
    inserted.onConflict().doNothing()

    expect(inserted.toSQL().text).toBe(
      'INSERT INTO "vote" AS "vote" ("form_id", "user_id", "votes") VALUES ($1, $2, $3)',
    )
  })

  it("resolves to the number or the fields of the inserted rows, without a row when it conflicts", async () => {
    const { db } = connect(0)

    expect(await db.form.insert({ name: "Survey" }).onConflict().doNothing()).toBe(0)
    expect(await db.form.insert({ name: "Survey" }).onConflict().doNothing().get("id")).toBe(
      undefined,
    )
    expect(
      await db.form
        .insertMany([{ name: "Survey" }])
        .onConflict("id")
        .doNothing()
        .select("id"),
    ).toEqual([])
  })

  it("rejects awaiting a conflict without an action", async () => {
    const { db } = connect(1)
    const target = db.form.insert({ name: "Survey" }).onConflict()

    await expect(Promise.resolve(target as unknown)).rejects.toThrow(
      "onConflict needs an action before the mutation runs, such as doNothing()",
    )
  })
})

describe("upsert", () => {
  it("inserts the record of the key of find or findBy, updating the columns of the values on a conflict on the key, named in its order", () => {
    expect(
      from(vote).findBy({ userId: 2, formId: 1 }).upsert({ votes: 3, note: undefined }).toSQL(),
    ).toEqual({
      text: 'INSERT INTO "vote" AS "vote" ("user_id", "form_id", "votes") VALUES ($1, $2, $3) ON CONFLICT ("form_id", "user_id") DO UPDATE SET "votes" = "excluded"."votes"',
      parameters: ["2", "1", "3"],
    })
    expect(from(vote).find(5).upsert({ formId: 1, userId: 2, votes: 3 }).toSQL().text).toBe(
      'INSERT INTO "vote" AS "vote" ("id", "form_id", "user_id", "votes") VALUES ($1, $2, $3, $4) ON CONFLICT ("id") DO UPDATE SET "form_id" = "excluded"."form_id", "user_id" = "excluded"."user_id", "votes" = "excluded"."votes"',
    )
  })

  it("inserts the row of a singleton table, updating the columns of the values on a conflict on its row", () => {
    expect(from(license).upsert({ token: "Token", note: undefined }).toSQL()).toEqual({
      text: 'INSERT INTO "license" AS "license" ("token") VALUES ($1) ON CONFLICT ((true)) DO UPDATE SET "token" = "excluded"."token"',
      parameters: ["Token"],
    })
    expect(from(license).upsert({ token: "Token" }).get("id").toSQL().text).toBe(
      'INSERT INTO "license" AS "license" ("token") VALUES ($1) ON CONFLICT ((true)) DO UPDATE SET "token" = "excluded"."token" RETURNING "license"."id" AS "id"',
    )
    // `find` of its row keeps the key, as of another table.
    expect(from(license).find(5).upsert({ token: "Token" }).toSQL().text).toBe(
      'INSERT INTO "license" AS "license" ("id", "token") VALUES ($1, $2) ON CONFLICT ("id") DO UPDATE SET "token" = "excluded"."token"',
    )
  })

  it("changes rows one and returns the fields selected after it", () => {
    const upserted = from(vote).findBy({ formId: 1, userId: 2 }).upsert({ votes: 3 })

    expect(upserted.node).toMatchObject({ rows: "one", value: false })
    expect(upserted.get("id").toSQL().text).toBe(
      'INSERT INTO "vote" AS "vote" ("form_id", "user_id", "votes") VALUES ($1, $2, $3) ON CONFLICT ("form_id", "user_id") DO UPDATE SET "votes" = "excluded"."votes" RETURNING "vote"."id" AS "id"',
    )
  })

  it("applies only right after find or findBy of a query of a table without clauses, or to a query of a singleton table without clauses", () => {
    let relation: AnySelectQuery | undefined
    schema.form.select(columns => {
      relation = columns.fields
      return {}
    })
    const message =
      "upsert applies only to a query of a singleton table or right after find or findBy of a query of a table, without clauses such as filters, optional, or selected fields; select the fields that it returns after it"

    for (const query of [
      schema.form,
      schema.form.where({ name: "Survey" }).find(1),
      schema.form.find(1).where({ name: "Survey" }),
      schema.form.find(1).optional(),
      schema.form.find(1).nullable(),
      schema.form.find(1).required(),
      schema.form.select("id").find(1),
      schema.form.find(1).select("id"),
      schema.form.orderBy("id").find(1),
      schema.form.take().find(1),
      schema.form.all().find(1),
      schema.form.find(1).forUpdate(),
      schema.form.find(1).map(row => row),
      relation!.findBy({ id: 1 }),
    ] as AnySelectQuery[]) {
      expect(() => query.upsert({ name: "Survey" })).toThrow(message)
    }
    for (const query of [
      from(license).where({ token: "Token" }),
      from(license).take(),
      from(license).optional(),
      from(license).required(),
      from(license).select("id"),
      from(license).forUpdate(),
    ] as AnySelectQuery[]) {
      expect(() => query.upsert({ token: "Token" })).toThrow(message)
    }
    // `use` returns the query of its callback, here the query of `find` itself.
    expect(
      schema.form
        .find(1)
        .use(query => query)
        .upsert({ name: "Survey" })
        .toSQL().text,
    ).toBe(
      'INSERT INTO "form" AS "form" ("id", "name") VALUES ($1, $2) ON CONFLICT ("id") DO UPDATE SET "name" = "excluded"."name"',
    )
  })

  it("rejects a value of a column of the key, values without a value, and values that are no object", () => {
    const found = from(vote).find(5) as AnySelectQuery

    expect(() => found.upsert({ id: 6, votes: 1 })).toThrow(
      'upsert takes the values of the columns other than the key of find or findBy, not of "id"',
    )
    expect(found.upsert({ id: undefined, votes: 1 }).toSQL().text).toBe(
      'INSERT INTO "vote" AS "vote" ("id", "votes") VALUES ($1, $2) ON CONFLICT ("id") DO UPDATE SET "votes" = "excluded"."votes"',
    )
    for (const values of [{}, { votes: undefined }]) {
      expect(() => found.upsert(values)).toThrow(
        "upsert takes the value of at least one column other than the key; to insert the record of the key unless it exists, use insert(...).onConflict(...).doNothing()",
      )
    }
    expect(() => found.upsert(null as never)).toThrow(
      'upsert takes the values of the columns of table "vote"',
    )
    expect(() => from(license).upsert({ token: undefined } as never)).toThrow(
      "upsert takes the value of at least one column; to insert the row unless it exists, use insert(...).onConflict().doNothing()",
    )
  })

  it("leaves the query of find unchanged and resolves to the number or the fields of the row", async () => {
    const { db } = connect(1, [["1"]])
    const found = db.form.find(1)

    expect(await found.upsert({ name: "Survey" })).toBe(1)
    expect(await found.upsert({ name: "Survey" }).get("id")).toBe(1)
    expect(found.toSQL().text).toBe('SELECT FROM "app"."form" AS "form" WHERE "form"."id" = $1')
  })
})

describe("values of queries", () => {
  const value = schema.form.find(2).get("note")

  it("are scalar subqueries of the statement, with its parameters in order", () => {
    expect(schema.form.insert({ name: "Survey", note: value }).toSQL()).toEqual({
      text: 'INSERT INTO "form" AS "form" ("name", "note") VALUES ($1, (SELECT "form_2"."note" AS "note" FROM "form" AS "form_2" WHERE "form_2"."id" = $2))',
      parameters: ["Survey", "2"],
    })
    expect(schema.form.find(1).update({ note: value }).toSQL()).toEqual({
      text: 'UPDATE "form" AS "form" SET "note" = (SELECT "form_2"."note" AS "note" FROM "form" AS "form_2" WHERE "form_2"."id" = $1) WHERE "form"."id" = $2',
      parameters: ["2", "1"],
    })
  })

  it("reject a query other than of one value", () => {
    const message = "An expression takes a query of one value"
    const records = schema.form.select("note")
    const values = schema.form.pluck("note")

    // @ts-expect-error A query of records is not of one value.
    expect(() => schema.form.insert({ name: "Survey", note: records })).toThrow(message)
    // @ts-expect-error A query of an array is not of one value.
    expect(() => schema.form.find(1).update({ note: values })).toThrow(message)
    expect(() =>
      // @ts-expect-error A mutation is not a query of one value.
      schema.form.find(1).update({ note: schema.form.find(1).delete().get("note") }),
    ).toThrow(`${message} of a table`)
  })

  it("are checked by a Db at any depth, as queries in expressions", () => {
    const { driver } = createRecordingDriver()
    const db = bindSchema(schema, createDatabase({ driver }))
    const other = bindSchema(schema, createDatabase({ driver }))
    const withoutRelations = bindSchema(defineSchema({ form, field }), createDatabase({ driver }))
    const related = schema.form.where(columns => columns.fields.exists()).get("note")
    const message = 'Relation "form.fields" is not part of the schema'

    expect(() => db.$compile(schema.form.find(1).update({ note: related }))).not.toThrow()
    // A query of one value does not carry the relations of its condition, so only lowering rejects them.
    expect(() => withoutRelations.$compile(schema.form.find(1).update({ note: related }))).toThrow(
      message,
    )
    expect(() =>
      withoutRelations.$compile(schema.form.insert({ name: "Survey", note: related })),
    ).toThrow(message)
    expect(() => db.$compile(db.form.find(1).update({ note: other.form.get("note") }))).toThrow(
      "A query in an expression is bound to another Db",
    )
    expect(() =>
      db.$compile(db.form.insert({ name: "Survey", note: other.form.get("note") })),
    ).toThrow("A query in an expression is bound to another Db")
  })
})

describe("update", () => {
  it("updates the rows of the filters of the query with values or the expressions of a callback", () => {
    const query = schema.form
      .where({ note: null })
      .update(columns => ({ name: sql<string>`upper(${columns.name})`, note: "upper" }))

    expect(query.toSQL()).toEqual({
      text: 'UPDATE "form" AS "form" SET "name" = upper("form"."name"), "note" = $1 WHERE "form"."note" IS NULL',
      parameters: ["upper"],
    })
    expect(schema.form.find(1).update({ name: "Survey", note: undefined }).toSQL()).toEqual({
      text: 'UPDATE "form" AS "form" SET "name" = $1 WHERE "form"."id" = $2',
      parameters: ["Survey", "1"],
    })
  })

  it("selects the rows that it would update, changing none, without a column to set", () => {
    expect(schema.form.find(1).update({}).toSQL()).toEqual({
      text: 'SELECT FROM "form" AS "form" WHERE "form"."id" = $1',
      parameters: ["1"],
    })
    expect(
      schema.form
        .where({ name: "Survey" })
        .update(() => ({ note: undefined }))
        .select(columns => ({
          id: columns.id,
          name: sql(t.text)`left(${columns.name}, ${1})`,
        }))
        .toSQL(),
    ).toEqual({
      text: 'SELECT "form"."id" AS "id", left("form"."name", $1) AS "name" FROM "form" AS "form" WHERE "form"."name" = $2',
      parameters: ["1", "Survey"],
    })
    expect(schema.form.all().update({}).select().toSQL().text).toBe('SELECT FROM "form" AS "form"')
  })
})

describe("delete", () => {
  it("deletes the rows of the filters of the query", () => {
    expect(schema.form.where({ name: "Survey" }).delete().toSQL()).toEqual({
      text: 'DELETE FROM "form" AS "form" WHERE "form"."name" = $1',
      parameters: ["Survey"],
    })
  })
})

describe("update of a query of a relation", () => {
  it("sets a column from a scalar subquery correlated with the row, also through an expression", () => {
    const query = schema.form.find(1).update(columns => ({
      name: coalesce(columns.fields.max("label"), "Empty"),
      note: columns.fields.orderBy("id").get("label"),
    }))

    expect(query.toSQL()).toEqual({
      text: 'UPDATE "form" AS "form" SET "name" = coalesce((SELECT max("form_field"."label") AS "max" FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id"), $1), "note" = (SELECT "form_field_2"."label" AS "label" FROM "form_field" AS "form_field_2" WHERE "form_field_2"."form_id" = "form"."id" ORDER BY "form_field_2"."id" LIMIT 1) WHERE "form"."id" = $2',
      parameters: ["Empty", "1"],
    })
  })

  it("rejects a query other than of one value in a callback", () => {
    expect(() =>
      // @ts-expect-error A query of an array is not of one value.
      schema.form.find(1).update(columns => ({ note: columns.fields.pluck("label") })),
    ).toThrow("An expression takes a query of one value")
    expect(() =>
      // @ts-expect-error A mutation is not a query of one value.
      schema.form.find(1).update(() => ({ note: schema.form.find(1).delete().get("name") })),
    ).toThrow("An expression takes a query of one value of a table")
  })

  it("is checked by a Db as a nested query of a selection, in the values and in what it returns", () => {
    const { driver } = createRecordingDriver()
    const db = bindSchema(schema, createDatabase({ driver }))
    const other = bindSchema(defineSchema({ form, field }), createDatabase({ driver }))
    const message = 'Relation "form.fields" is not part of the schema'
    const update = schema.form.find(1).update(columns => ({
      note: columns.fields.get("label"),
    }))
    const updateByExpression = schema.form.find(1).update(columns => ({
      note: coalesce(columns.fields.max("label"), "Empty"),
    }))
    const returning = schema.form
      .find(1)
      .update({ name: "Survey" })
      .get(columns => columns.fields.count())

    expect(() => db.$compile(update)).not.toThrow()
    // @ts-expect-error The schema of the Db lacks the relation.
    expect(() => other.$compile(update)).toThrow(message)
    // An expression does not carry the relations of its queries, so only lowering rejects it.
    expect(() => other.$compile(updateByExpression)).toThrow(message)
    // @ts-expect-error The schema of the Db lacks the relation.
    expect(() => other.$compile(returning)).toThrow(message)
  })

  it("rejects a query of a relation in a filter of the changed rows of another schema", () => {
    const { driver } = createRecordingDriver()
    const other = bindSchema(defineSchema({ form, field }), createDatabase({ driver }))

    expect(() =>
      other.$compile(
        schema.form.where(columns => columns.fields.exists()).update({ name: "Survey" }),
      ),
    ).toThrow('Relation "form.fields" is not part of the schema')
  })

  it("rejects a bound query of another Db", () => {
    const { driver } = createRecordingDriver()
    const db = bindSchema(schema, createDatabase({ driver }))
    const other = bindSchema(schema, createDatabase({ driver }))

    expect(() =>
      db.$compile(db.form.find(1).update(() => ({ note: other.field.max("label") }))),
    ).toThrow("A query in an expression is bound to another Db")
  })
})

describe("update and delete", () => {
  const mutations = {
    update: (query: AnySelectQuery) => query.update({ name: "Survey" }),
    delete: (query: AnySelectQuery) => query.delete(),
  }

  it("change every row of a query of all", () => {
    expect(schema.form.all().delete().toSQL().text).toBe('DELETE FROM "form" AS "form"')
    expect(schema.form.all().update({ name: "Survey" }).toSQL().text).toBe(
      'UPDATE "form" AS "form" SET "name" = $1',
    )
  })

  it("reject a query without a filter that restricts its rows unless all allows it", () => {
    for (const [method, mutate] of Object.entries(mutations)) {
      const message = `${method} requires a filter that restricts the rows, such as of where or find; call all() to ${method} every row`

      expect(() => mutate(schema.form)).toThrow(message)
      expect(() => mutate(schema.form.where({}))).toThrow(message)
      expect(() => mutate(schema.form.all().where({ name: "Survey" }))).not.toThrow()
      // A filter that matches no row restricts the rows.
      expect(() => mutate(schema.form.where(columns => columns.id.in([])))).not.toThrow()
    }
  })

  it("reject a query whose rows they cannot limit, with selected fields, or of a relation", () => {
    let relation: AnySelectQuery | undefined
    schema.form.select(columns => {
      relation = columns.fields
      return {}
    })

    for (const [method, mutate] of Object.entries(mutations)) {
      for (const query of [
        schema.form.where({ name: "Survey" }).take(),
        schema.form.all().orderBy("id"),
        schema.form.all().limit(1),
        schema.form.all().offset(1),
        schema.form.all().distinct(),
        schema.form.all().distinctOn("name"),
      ]) {
        expect(() => mutate(query)).toThrow(
          `${method} cannot sort or limit the rows it changes; choose them with where, find, or findBy instead of take, limit, offset, orderBy, distinct, or distinctOn`,
        )
      }
      expect(() => mutate(schema.form.all().groupBy("id"))).toThrow(
        `${method} changes rows rather than groups; choose them with where, find, or findBy instead of groupBy`,
      )
      expect(() => mutate(schema.form.find(1).forUpdate())).toThrow(
        `${method} locks the rows it changes itself, so its query takes no row lock`,
      )
      expect(() => mutate(schema.form.find(1).select("id"))).toThrow(
        `${method} returns the fields selected after it, not before; call select, get, or pluck after ${method}`,
      )
      expect(() => mutate(relation!.where({ label: "Name" }))).toThrow(
        `${method} applies only to a query of a table, not of a relation`,
      )
    }
  })

  it("change the row of a query of find or findBy in its rows mode", () => {
    expect(schema.form.find(1).delete().node.rows).toBe("one")
    expect(schema.form.find(1).optional().update({ name: "Survey" }).node.rows).toBe("optional")
    expect(schema.field.findBy({ id: 1 }).nullable().delete().node.rows).toBe("nullable")
  })

  it("change the row of a singleton table without a filter, in the rows mode of its query", () => {
    const deleted = from(license).delete()

    expect(deleted.toSQL().text).toBe('DELETE FROM "license" AS "license"')
    expect(deleted.node.rows).toBe("optional")
    expect(from(license).update({ token: "Token" }).toSQL().text).toBe(
      'UPDATE "license" AS "license" SET "token" = $1',
    )
    expect(from(license).required().update({ token: "Token" }).node.rows).toBe("one")
    expect(from(license).where({ token: "Token" }).delete().toSQL().text).toBe(
      'DELETE FROM "license" AS "license" WHERE "license"."token" = $1',
    )
  })
})

describe("all", () => {
  it("rejects a query of one row", () => {
    expect(() => (schema.form.find(1) as AnySelectQuery).all()).toThrow(
      "all applies only to a query of many rows",
    )
  })
})

describe("returned fields", () => {
  const updated = schema.form.find(1).update({ name: "Survey" })

  it("select the columns and the expressions of the changed rows in their rows mode", () => {
    const query = updated.select("id").select(columns => ({
      title: sql(t.text)`upper(${columns.name})`,
    }))

    expect(query.toSQL().text).toBe(
      'UPDATE "form" AS "form" SET "name" = $1 WHERE "form"."id" = $2 RETURNING "form"."id" AS "id", upper("form"."name") AS "title"',
    )
    expect(query.node).toMatchObject({ rows: "one", value: false })
    expect(schema.form.all().delete().select("*").node).toMatchObject({ rows: "many" })
  })

  it("nest the rows of the relations of the changed rows", () => {
    const query = schema.form.insert({ name: "Survey" }).select(columns => ({
      fields: columns.fields.select("label"),
    }))

    expect(query.toSQL().text).toBe(
      `INSERT INTO "form" AS "form" ("name") VALUES ($1) RETURNING (SELECT coalesce(json_agg(json_build_array(CASE WHEN "subquery"."label" IS NOT DISTINCT FROM NULL THEN NULL ELSE format('%s', "subquery"."label") END)), '[]'::json) AS "rows" FROM (SELECT "form_field"."label" AS "label" FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id") AS "subquery") AS "fields"`,
    )
  })

  it("return the value of get and pluck, which replace the returned fields", () => {
    expect(updated.select("name").get("id").toSQL().text).toBe(
      'UPDATE "form" AS "form" SET "name" = $1 WHERE "form"."id" = $2 RETURNING "form"."id" AS "id"',
    )
    expect(schema.form.find(1).nullable().delete().get("id").node).toMatchObject({
      rows: "optional",
      value: true,
    })
    expect(
      schema.form
        .all()
        .delete()
        .pluck(columns => columns.name).node,
    ).toMatchObject({
      rows: "many",
      value: true,
    })
  })

  it("reject get of a mutation of many rows, select after get or pluck, and a nested mutation", () => {
    const deleted: AnyMutationQuery = schema.form.all().delete()

    expect(() => deleted.get("id")).toThrow(
      "get applies only to a query that changes one row, such as of insert or find; use pluck to return the values of several rows",
    )
    // @ts-expect-error Types reject select after pluck.
    expect(() => deleted.pluck("id").select("name")).toThrow(
      "select cannot be used after get or pluck; call get or pluck to replace the value",
    )
    expect(() => from(form).select(() => ({ deleted }) as never)).toThrow(
      'Selected field "deleted" is a query of insert, update, or delete, which cannot be nested',
    )
  })

  it("leave the mutation they derive from unchanged", () => {
    updated.select("id")
    updated.get("name")

    expect(updated.toSQL().text).toBe(
      'UPDATE "form" AS "form" SET "name" = $1 WHERE "form"."id" = $2',
    )
  })
})

describe("use", () => {
  const insert = schema.form.insert({ name: "Survey" })
  const withName = defineHelper(schema.form, query => query.select("name"))

  it("selects what a helper selects, as select does on each kind of a mutation", () => {
    const updated = schema.form.find(1).update({ name: "Survey" })
    const deleted = schema.form.where({ name: "Survey" }).delete()

    expect(insert.use(withName).toSQL()).toEqual(insert.select("name").toSQL())
    expect(updated.use(withName).toSQL()).toEqual(updated.select("name").toSQL())
    expect(deleted.use(withName).toSQL()).toEqual(deleted.select("name").toSQL())
    expect(deleted.use(withName).node).toMatchObject({ rows: "many", value: false })
  })

  it("adds what a helper selects to the fields selected before, passing the arguments of the helper", async () => {
    const withTitle = defineHelper(schema.form, (query, title: string) =>
      query.select(columns => ({
        title: sql(t.text)`upper(${columns.name}) || ${title}`,
      })),
    )
    const { db, statements } = connect(1, [["1", "SURVEY!"]])

    expect(await db.form.insert({ name: "Survey" }).select("id").use(withTitle, "!")).toEqual({
      id: 1,
      title: "SURVEY!",
    })
    expect(statements[0]?.parameters).toEqual(["Survey", "!"])
  })

  it("keeps the number of the rows with a helper that selects nothing", async () => {
    const same = defineHelper(schema.form, query => query)
    const { db } = connect(2)

    expect(await db.form.where({ name: "Survey" }).delete().use(same)).toBe(2)
  })

  it("selects the relations of the changed rows through a helper of a schema", () => {
    const withFieldIds = defineHelper(schema.form, query =>
      query.select(columns => ({
        fieldIds: columns.fields.pluck("id"),
      })),
    )

    expect(insert.use(withFieldIds).toSQL().text).toContain("RETURNING (SELECT")
  })

  it("applies a callback, which returns the mutation it receives or one derived from it", async () => {
    const { db } = connect(1, [["1"]])
    const inserted = db.form.insert({ name: "Survey" })

    expect(inserted.use(query => query)).toBe(inserted)
    expect(await inserted.use(query => query.get("id"))).toBe(1)
  })

  it("rejects a callback that returns another mutation or a query of a table", () => {
    const returnTable = () => schema.form

    expect(() => insert.use(() => schema.form.insert({ name: "Other" }))).toThrow(
      "The callback of use must return the query it receives",
    )
    // @ts-expect-error The callback returns no mutation.
    expect(() => insert.use(returnTable)).toThrow(
      "The callback of use must return the query it receives",
    )
  })

  it("fails with the methods of a query that a mutation lacks, also those that types do not reject", () => {
    const filtered = defineHelper(schema.form, query => query.where({ id: 1 }))
    const sorted = defineHelper(schema.form, query => query.orderBy("name"))
    const grouped = defineHelper(schema.form, query => query.groupBy("name"))

    // @ts-expect-error A mutation does not filter.
    expect(() => insert.use(filtered)).toThrow()
    expect(() => insert.use(sorted)).toThrow()
    expect(() => insert.use(grouped)).toThrow()
  })

  it("rejects a selection of no fields on a mutation of the number of its rows, whose types keep the number", async () => {
    const empty = defineHelper(schema.form, query => query.select(() => ({})))
    const message = "The callback of use must select at least one field"
    const { db } = connect(1, [["1"]])

    expect(() => insert.use(empty)).toThrow(message)
    expect(() => insert.use(query => query.select(() => ({})))).toThrow(message)
    expect(await db.form.insert({ name: "Survey" }).select("id").use(empty)).toEqual({ id: 1 })
  })
})

describe("execution", () => {
  it("resolves to the number of the changed rows, rejecting without the row of find unless it is optional", async () => {
    const { db, statements } = connect(0)

    expect(await db.form.where({ name: "Survey" }).delete()).toBe(0)
    expect(await db.form.find(1).optional().delete()).toBe(0)
    await expect(Promise.resolve(db.form.find(1).delete())).rejects.toThrow(NotFoundError)
    expect(statements[0]).toEqual({
      connection: "pool",
      text: 'DELETE FROM "app"."form" AS "form" WHERE "form"."name" = $1',
      parameters: ["Survey"],
    })
  })

  it("decodes the returned fields of the changed rows", async () => {
    const { db } = connect(2, [["1"], ["2"]])

    expect(
      await db.form.insertMany([{ name: "Survey" }, { name: "Feedback" }]).pluck("id"),
    ).toEqual([1, 2])
    expect(await db.$execute(schema.form.all().delete().select("id"))).toEqual([
      { id: 1 },
      { id: 2 },
    ])
  })

  it("rejects a mutation bound to another Db", () => {
    const { db } = connect(0)
    const other = connect(0).db

    expect(() => db.$compile(other.form.find(1).delete())).toThrow(
      "Cannot run a query bound to another Db",
    )
  })
})

describePostgres("in PostgreSQL", ({ database, testTransaction, useTestFixture }) => {
  useTestFixture(() =>
    database.script(`
      CREATE TABLE form (id integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY, name text NOT NULL, note text);
      CREATE TABLE form_field (id integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY, form_id integer NOT NULL REFERENCES form, label text NOT NULL);
      INSERT INTO form (id, name) OVERRIDING SYSTEM VALUE VALUES (100, 'Survey');
      INSERT INTO form_field (form_id, label) VALUES (100, 'Name'), (100, 'Email');
    `),
  )

  const db = bindSchema(schema, database)

  it("inserts records with the defaults of the columns they omit, returning their fields", async () => {
    const { id, inserted, stored } = await testTransaction(async () => {
      const id = await db.form.insert({ name: "First" }).get("id")
      const inserted = await db.form
        .insertMany([{ name: "Second", note: "note" }, { name: "Third" }])
        .select("id", "name", "note")
      const stored = await db.form
        .where(columns => columns.id.in([id, ...inserted.map(form => form.id)]))
        .orderBy("id")
        .pluck("name")
      return { id, inserted, stored }
    })

    expect(typeof id).toBe("number")
    expect(inserted).toHaveLength(2)
    expect(inserted).toEqual(
      expect.arrayContaining([
        { id: expect.any(Number), name: "Second", note: "note" },
        { id: expect.any(Number), name: "Third", note: null },
      ]),
    )
    expect(stored).toEqual(["First", "Second", "Third"])
  })

  it("updates and deletes the rows of their filters, resolving to their number", async () => {
    const counts = await testTransaction(async () => [
      await db.form.insertMany([{ name: "a" }, { name: "b" }]),
      await db.form
        .where(columns => columns.name.in(["a", "b"]))
        .update(columns => ({
          note: columns.name,
        })),
      await db.form.where({ note: "a" }).delete(),
      await db.form.count(),
    ])

    expect(counts).toEqual([2, 2, 1, 2])
  })

  it("changes no row without a column to set, resolving to the rows it would update", async () => {
    const results = await testTransaction(async () => {
      const missing = db.form.find(1).update({})
      await expect(Promise.resolve(missing)).rejects.toThrow(NotFoundError)
      return {
        missingCount: await db.form.find(1).optional().update({}),
        count: await db.form.find(100).update({ note: undefined }),
        record: await db.form.find(100).update({}).select("name", "note"),
        records: await db.form.all().update({}).select(),
      }
    })

    expect(results).toEqual({
      missingCount: 0,
      count: 1,
      record: { name: "Survey", note: null },
      records: [{}],
    })
  })

  it("sets the values of queries of one value in its statement, NULL without a row", async () => {
    const result = await testTransaction(async () => {
      const inserted = await db.form
        .insert({
          name: db.field.min("label").coalesce("None"),
          note: db.form.find(100).get("name"),
        })
        .select("name", "note")
      const many = await db.form.insertMany([
        { name: "Largest", note: db.field.max("label") },
        { name: "Plain" },
        { name: "Missing", note: db.form.find(-1).get("name") },
      ])
      const updated = await db.form
        .find(100)
        .update({
          note: db.field.where({ formId: 100 }).orderBy("id").get("label"),
        })
        .get("note")
      const notes = await db.form.where({ name: "Largest" }).get("note")
      const missing = await db.form.where({ name: "Missing" }).get("note")
      return { inserted, many, updated, notes, missing }
    })

    expect(result).toEqual({
      inserted: { name: "Email", note: "Survey" },
      many: 3,
      updated: "Name",
      notes: "Name",
      missing: null,
    })
  })

  it("rejects a query without its row as a value of a column that is not nullable", async () => {
    const message = /null value in column "name"/

    await testTransaction(async () => {
      const missing = db.form.find(-1).get("name")

      await expect(
        db.$transaction(async () => {
          await db.form.insert({ name: missing })
        }),
      ).rejects.toThrow(message)
      await expect(
        db.$transaction(async () => {
          await db.form.find(100).update({ name: missing })
        }),
      ).rejects.toThrow(message)
      expect(await db.form.find(100).get("name")).toBe("Survey")
    })
  })

  it("rejects a mutation of find without its row unless it is optional, keeping the transaction usable", async () => {
    const results = await testTransaction(async () => {
      const missing = db.form.find(1).update({ name: "Missing" })
      await expect(Promise.resolve(missing)).rejects.toThrow(NotFoundError)
      return [
        await db.form.find(1).optional().update({ name: "Missing" }),
        await db.form.find(100).update({ name: "Renamed" }).get("name"),
        await db.form.find(1).optional().delete().get("name"),
      ]
    })

    expect(results).toEqual([0, "Renamed", undefined])
  })

  it("keeps the change of a mutation that rejects after it, unless the error leaves a transaction", async () => {
    const names = await testTransaction(async () => {
      /** Inserts form `name`, selecting a missing form, whose row rejects after the insert. */
      const insertWithMissing = (name: string) =>
        db.form.insert({ name }).select(() => ({
          missing: schema.form.find(-1).select("id"),
        }))
      await expect(Promise.resolve(insertWithMissing("Kept"))).rejects.toThrow(NotFoundError)
      await expect(
        db.$transaction(async () => {
          await insertWithMissing("Undone")
        }),
      ).rejects.toThrow(NotFoundError)
      return await db.form.orderBy("name").pluck("name")
    })

    expect(names).toEqual(["Kept", "Survey"])
  })

  it("nests the rows of relations as the database was before the mutation, apart from the changed rows", async () => {
    const forms = await testTransaction(async () =>
      db.form
        .find(100)
        .update({ name: "Renamed" })
        .select(columns => ({
          name: columns.name,
          fields: columns.fields.orderBy("id").select(fieldColumns => ({
            label: fieldColumns.label,
            formName: fieldColumns.form.get("name"),
          })),
        })),
    )

    expect(forms).toEqual({
      name: "Renamed",
      fields: [
        { label: "Name", formName: "Survey" },
        { label: "Email", formName: "Survey" },
      ],
    })
  })

  it("deletes the rows that it returns with their relations", async () => {
    const deleted = await testTransaction(async () => {
      const fields = await db.field
        .where({ formId: 100 })
        .delete()
        .select(columns => ({
          label: columns.label,
          form: columns.form.select("name"),
        }))
      return [fields, await db.field.count()]
    })

    expect(deleted).toEqual([
      expect.arrayContaining([
        { label: "Name", form: { name: "Survey" } },
        { label: "Email", form: { name: "Survey" } },
      ]),
      0,
    ])
  })
})

describePostgres("conflicts in PostgreSQL", ({ database, testTransaction, useTestFixture }) => {
  const tag = defineTable("tag", {
    id: t.integer.primaryKey(),
    name: t.text.unique(),
    uses: t.integer.hasDefault(),
  })

  useTestFixture(() =>
    database.script(`
      CREATE TABLE tag (id integer PRIMARY KEY, name text NOT NULL UNIQUE, uses integer NOT NULL DEFAULT 0);
      INSERT INTO tag (id, name) VALUES (1, 'urgent');
    `),
  )

  const db = bindSchema(defineSchema({ tag }), database)

  it("skips the rows that conflict on the key of its target or on any key, returning the inserted rows", async () => {
    const result = await testTransaction(async () => ({
      skipped: await db.tag
        .insert({ id: 1, name: "other" })
        .onConflict("id")
        .doNothing()
        .get("name"),
      inserted: await db.tag.insert({ id: 2, name: "later" }).onConflict().doNothing().get("name"),
      many: await db.tag
        .insertMany([
          { id: 3, name: "urgent" },
          { id: 4, name: "new" },
        ])
        .onConflict()
        .doNothing()
        .pluck("id"),
      count: await db.tag.insert({ id: 1, name: "urgent" }).onConflict("name").doNothing(),
      names: await db.tag.orderBy("id").pluck("name"),
    }))

    expect(result).toEqual({
      skipped: undefined,
      inserted: "later",
      many: [4],
      count: 0,
      names: ["urgent", "later", "new"],
    })
  })

  it("updates the existing records by merge and update, returning the inserted and the updated rows", async () => {
    const result = await testTransaction(async () => ({
      merged: await db.tag
        .insertMany([
          { id: 1, name: "renamed" },
          { id: 2, name: "new" },
        ])
        .onConflict("id")
        .merge("name")
        .select("id", "name"),
      count: await db.tag
        .insertMany([
          { id: 2, name: "again" },
          { id: 3, name: "third" },
        ])
        .onConflict("id")
        .merge("name"),
      uses: [
        await db.tag
          .insert({ id: 1, name: "ignored", uses: 2 })
          .onConflict("id")
          .update((existing, excluded) => ({
            uses: sql(t.integer)`${existing.uses} + ${excluded.uses}`,
          }))
          .get("uses"),
        await db.tag
          .insert({ id: 1, name: "ignored", uses: 3 })
          .onConflict("id")
          .update((existing, excluded) => ({
            uses: sql(t.integer)`${existing.uses} + ${excluded.uses}`,
          }))
          .get("uses"),
      ],
      tags: await db.tag.orderBy("id").select("name", "uses"),
    }))

    expect(result).toEqual({
      merged: expect.arrayContaining([
        { id: 1, name: "renamed" },
        { id: 2, name: "new" },
      ]),
      count: 2,
      uses: [2, 5],
      tags: [
        { name: "renamed", uses: 5 },
        { name: "again", uses: 0 },
        { name: "third", uses: 0 },
      ],
    })
  })

  it("reads the existing and the proposed rows in a nested query of update", async () => {
    // The existing row, the proposed row, and the rows of the nested query differ, so that a reference to another of them counts 0 or 2 rows.
    const uses = await testTransaction(async () => {
      await db.tag.insert({ id: 2, name: "later" })
      return db.tag
        .insert({ id: 99, name: "urgent", uses: 2 })
        .onConflict("name")
        .update((existing, excluded) => ({
          uses: db.tag
            .where(tag => tag.id.eq(existing.id))
            .where(tag => tag.uses.lt(excluded.uses))
            .count(),
        }))
        .get("uses")
    })

    expect(uses).toBe(1)
  })

  it("rejects two rows of one statement that update the same record", async () => {
    await testTransaction(async () => {
      await expect(
        db.$transaction(async () => {
          await db.tag
            .insertMany([
              { id: 1, name: "first" },
              { id: 1, name: "second" },
            ])
            .onConflict("id")
            .merge("name")
        }),
      ).rejects.toThrow(/cannot affect row a second time/)
    })
  })

  it("rejects a row that conflicts on a key other than its target", async () => {
    await testTransaction(async () => {
      await expect(
        db.$transaction(async () => {
          await db.tag.insert({ id: 2, name: "urgent" }).onConflict("id").doNothing()
        }),
      ).rejects.toThrow(/duplicate key value violates unique constraint/)
    })
  })
})

describePostgres("upsert in PostgreSQL", ({ database, testTransaction, useTestFixture }) => {
  useTestFixture(() =>
    database.script(`
      CREATE TABLE vote (
        id integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
        form_id integer NOT NULL,
        user_id integer NOT NULL,
        votes integer NOT NULL,
        note text,
        UNIQUE (form_id, user_id)
      );
      INSERT INTO vote (id, form_id, user_id, votes, note) OVERRIDING SYSTEM VALUE VALUES (100, 1, 1, 2, 'kept');
    `),
  )

  const db = bindSchema(defineSchema({ vote }), database)

  it("inserts the record of a missing key and updates the values of an existing one, returning its row", async () => {
    const result = await testTransaction(async () => ({
      inserted: await db.vote
        .findBy({ formId: 1, userId: 2 })
        .upsert({ votes: 3 })
        .select("votes", "note"),
      updated: await db.vote
        .findBy({ userId: 1, formId: 1 })
        .upsert({ votes: 5 })
        .select("id", "votes", "note"),
      count: await db.vote.find(100).upsert({ formId: 1, userId: 1, votes: 7, note: null }),
      votes: await db.vote.orderBy("userId").select("userId", "votes", "note"),
    }))

    expect(result).toEqual({
      inserted: { votes: 3, note: null },
      updated: { id: 100, votes: 5, note: "kept" },
      count: 1,
      votes: [
        { userId: 1, votes: 7, note: null },
        { userId: 2, votes: 3, note: null },
      ],
    })
  })
})

describePostgres(
  "singleton tables in PostgreSQL",
  ({ database, testTransaction, useTestFixture }) => {
    useTestFixture(() =>
      database.script(`
        CREATE TABLE license (
          id integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
          token text NOT NULL,
          note text
        );
        CREATE UNIQUE INDEX license_singleton_idx ON license ((true));
      `),
    )

    const db = bindSchema(defineSchema({ license }), database)

    it("upserts the missing row and the values of the existing one, keeping its other values", async () => {
      const result = await testTransaction(async () => ({
        missing: await db.license,
        inserted: await db.license.upsert({ token: "first", note: "kept" }).select("id", "token"),
        updated: await db.license.upsert({ token: "second" }).select("id", "token", "note"),
        token: await db.license.get("token"),
      }))

      expect(result).toEqual({
        missing: undefined,
        inserted: { id: expect.any(Number), token: "first" },
        updated: { id: result.inserted.id, token: "second", note: "kept" },
        token: "second",
      })
    })

    it("updates and deletes its row without all, resolving to 0 without it unless required", async () => {
      const result = await testTransaction(async () => {
        const missing = await db.license.update({ note: "none" })
        await expect(Promise.resolve(db.license.required().delete())).rejects.toThrow(NotFoundError)
        await db.license.insert({ token: "first" })
        return {
          missing,
          note: await db.license.update({ note: "set" }).get("note"),
          deleted: await db.license.delete().get("token"),
          exists: await db.license.exists(),
        }
      })

      expect(result).toEqual({ missing: 0, note: "set", deleted: "first", exists: false })
    })

    it("rejects a second row by its unique index, and its query rejects a second row without the index", async () => {
      await testTransaction(async () => {
        await db.license.insert({ token: "first" })
        await expect(
          db.$transaction(async () => {
            await db.license.insert({ token: "second" })
          }),
        ).rejects.toThrow(/duplicate key value violates unique constraint "license_singleton_idx"/)
        await db.$script("DROP INDEX license_singleton_idx")
        await db.license.insert({ token: "second" })
        await expect(Promise.resolve(db.license.get("token"))).rejects.toThrow(
          "Query of one row returned 2 rows",
        )
      })
    })
  },
)

// Testing concurrent upserts requires separate connections, which see only committed rows, so these tests commit them in a PostgreSQL schema of their own, which each test drops.
describePooledPostgres("concurrent upserts in PostgreSQL", ({ database }) => {
  const db = bindSchema(defineSchema({ vote, license }), database, { schemaName: "upsert_test" })

  // The lock timeout fails a test that a transaction left open rather than hanging the others.
  beforeEach(() =>
    database.script(`
      SET LOCAL client_min_messages = warning;
      SET LOCAL lock_timeout = '5s';
      DROP SCHEMA IF EXISTS upsert_test CASCADE;
      CREATE SCHEMA upsert_test;
      CREATE TABLE upsert_test.vote (
        id integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
        form_id integer NOT NULL,
        user_id integer NOT NULL,
        votes integer NOT NULL,
        note text,
        UNIQUE (form_id, user_id)
      );
      CREATE TABLE upsert_test.license (
        id integer PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
        token text NOT NULL,
        note text
      );
      CREATE UNIQUE INDEX license_singleton_idx ON upsert_test.license ((true));
    `),
  )
  afterEach(() =>
    database.script(`
      SET LOCAL client_min_messages = warning;
      SET LOCAL lock_timeout = '5s';
      DROP SCHEMA upsert_test CASCADE;
    `),
  )

  // Orchid ORM 1.78.47 runs an UPDATE and, without its row, a second statement that inserts the record, so of two concurrent upserts of a missing record one rejects with a unique violation: https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/packages/pqb/src/query/sql/to-sql.ts#L196-L280
  it("updates the record that a concurrent upsert inserted once its transaction commits", async () => {
    const upsert = (votes: number) =>
      db.vote.findBy({ formId: 1, userId: 1 }).upsert({ votes }).get("votes")

    await whileHolding(
      db,
      () => upsert(1),
      async (inserted, commit) => {
        expect(inserted).toBe(1)
        const { result } = await startWaiting(db, () => upsert(2))
        await commit()
        expect(await result).toBe(2)
      },
    )
    expect(await db.vote.select("votes")).toEqual([{ votes: 2 }])
  })

  // Orchid ORM 1.78.47 upserts the row of a singleton table with all().take().upsert(), which runs an UPDATE and, without its row, a second statement that inserts it, so of two concurrent upserts of the missing row one rejects with a unique violation of the index of (true): https://github.com/romeerez/orchid-orm/issues/752, https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/packages/pqb/src/query/sql/to-sql.ts#L196-L280
  it("updates the row of a singleton table that a concurrent upsert inserted once its transaction commits", async () => {
    const upsert = (token: string) => db.license.upsert({ token }).get("token")

    await whileHolding(
      db,
      () => upsert("first"),
      async (inserted, commit) => {
        expect(inserted).toBe("first")
        const { result } = await startWaiting(db, () => upsert("second"))
        await commit()
        expect(await result).toBe("second")
      },
    )
    expect(await db.license.required().select("token")).toEqual({ token: "second" })
  })
})

describePostgres(
  "values of queries in PostgreSQL",
  ({ database, testTransaction, useTestFixture }) => {
    const board = defineTable("board", {
      id: t.integer.primaryKey(),
      parentId: t.integer.nullable().columnName("parent_id"),
      title: t.text.nullable(),
      postCount: t.integer.nullable().columnName("post_count"),
      hasPosts: t.boolean.nullable().columnName("has_posts"),
    })
    const post = defineTable("post", {
      id: t.integer.primaryKey(),
      boardId: t.integer.columnName("board_id"),
      title: t.text,
    })
    const boards = defineSchema({ board, post }).$relations({
      board: {
        posts: many(post, { from: "id", to: "boardId" }),
        parent: one(board, { from: "parentId", to: "id" }),
        children: many(board, { from: "id", to: "parentId" }),
      },
      post: {
        board: one(board, { from: "boardId", to: "id", required: true }),
      },
    })

    useTestFixture(() =>
      database.script(`
      CREATE TABLE board (id integer PRIMARY KEY, parent_id integer, title text, post_count integer, has_posts boolean);
      CREATE TABLE post (id integer PRIMARY KEY, board_id integer NOT NULL REFERENCES board, title text NOT NULL);
      INSERT INTO board (id, parent_id, title) VALUES (1, NULL, 'Root'), (2, 1, 'News'), (3, 1, 'Empty');
      INSERT INTO post (id, board_id, title) VALUES (1, 1, 'First'), (2, 1, 'Second'), (3, 2, 'Third');
    `),
    )

    const db = bindSchema(boards, database)
    const rows = () => db.board.orderBy("id").select("id", "title", "postCount", "hasPosts")

    it("gives each changed row the values of its own relations", async () => {
      const result = await testTransaction(async () => [
        await db.board.all().update(columns => ({
          postCount: columns.posts.count(),
          hasPosts: columns.posts.exists(),
        })),
        await rows(),
      ])

      expect(result).toEqual([
        3,
        [
          { id: 1, title: "Root", postCount: 2, hasPosts: true },
          { id: 2, title: "News", postCount: 1, hasPosts: true },
          { id: 3, title: "Empty", postCount: 0, hasPosts: false },
        ],
      ])
    })

    it("writes NULL for a query without its row", async () => {
      const titles = await testTransaction(async () => {
        await db.board.all().update(columns => ({
          title: columns.posts.orderBy("id").get("title"),
        }))
        return await db.board.orderBy("id").pluck("title")
      })

      expect(titles).toEqual(["First", "Third", null])
    })

    it("reads the rows of its table as they were before the update under an alias of their own", async () => {
      const result = await testTransaction(async () => {
        await db.board.all().update(columns => ({
          postCount: columns.children.count(),
          title: columns.parent.get("title"),
        }))
        return await rows()
      })

      expect(result).toEqual([
        { id: 1, title: null, postCount: 2, hasPosts: null },
        { id: 2, title: "Root", postCount: 0, hasPosts: null },
        { id: 3, title: "Root", postCount: 0, hasPosts: null },
      ])
    })

    it("takes a reusable expression that returns a query or an expression of one", async () => {
      const hasPosts = defineExpression(db.board, columns => columns.posts.exists())
      const postCount = defineExpression(db.board, columns => columns.posts.count().expr())
      const hasManyPosts = defineExpression(db.board, (columns, count: number) =>
        columns.posts.count().expr().gt(count),
      )
      const result = await testTransaction(async () => {
        await db.board.find(1).update(columns => ({
          hasPosts: hasPosts(columns),
          postCount: postCount(columns),
        }))
        await db.board.find(2).update(columns => ({
          hasPosts: hasManyPosts(columns, 1),
          postCount: coalesce(columns.children.max("postCount"), 7),
        }))
        return await rows()
      })

      expect(result).toEqual([
        { id: 1, title: "Root", postCount: 2, hasPosts: true },
        { id: 2, title: "News", postCount: 7, hasPosts: false },
        { id: 3, title: "Empty", postCount: null, hasPosts: null },
      ])
    })

    it("filters and returns by relations in one statement", async () => {
      const result = await testTransaction(async () => [
        await db.board
          .where(columns => columns.posts.exists())
          .update(columns => ({
            postCount: columns.posts.count(),
          }))
          .select("id", "postCount")
          .select(columns => ({
            firstPost: columns.posts.orderBy("id").get("title"),
          })),
        await db.board
          .find(3)
          .delete()
          .get(columns => columns.parent.get("title")),
      ])

      expect(result[0]).toEqual(
        expect.arrayContaining([
          { id: 1, postCount: 2, firstPost: "First" },
          { id: 2, postCount: 1, firstPost: "Third" },
        ]),
      )
      expect(result[1]).toBe("Root")
    })

    it("returns the values of a callback that reads a relation after insert, update, and delete", async () => {
      const result = await testTransaction(async () => ({
        inserted: await db.board
          .insert({ id: 4, parentId: 1, title: "New" })
          .get(columns => columns.parent.get("title")),
        updated: await db.board
          .find(1)
          .update({ title: "Renamed" })
          .get(columns => columns.posts.count()),
        plucked: await db.board
          .where({ parentId: 1 })
          .update({ hasPosts: false })
          .pluck(columns => columns.posts.exists()),
        deleted: await db.board
          .find(4)
          .delete()
          .get(columns => columns.parent.get("title")),
      }))

      expect(result.inserted).toBe("Root")
      expect(result.updated).toBe(2)
      expect(result.plucked.toSorted()).toEqual([false, false, true])
      expect(result.deleted).toBe("Renamed")
    })
  },
)
