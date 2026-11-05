import { describe, expect, it } from "bun:test"

import { describePostgres } from "../../testing/postgres"
import { createRecordingDriver } from "../../testing/recording-driver"
import { createDatabase } from "../execution/database"
import { coalesce } from "../expression/functions"
import { sql } from "../expression/sql"
import { NotFoundError } from "../result/result"
import { many, one } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

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
      schema.form.limit(1),
      schema.form.take(),
      schema.form.all(),
    ] as AnySelectQuery[]) {
      expect(() => query.insert({ name: "Survey" })).toThrow(message)
    }
    expect(() => schema.form.insertMany({ name: "Survey" } as never)).toThrow(
      "insertMany takes an array of records",
    )
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
    const db = createDatabase({ driver }).bind(schema)
    const other = createDatabase({ driver }).bind(schema)
    const withoutRelations = createDatabase({ driver }).bind(defineSchema({ form, field }))
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
    const db = createDatabase({ driver }).bind(schema)
    const other = createDatabase({ driver }).bind(defineSchema({ form, field }))
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
    const other = createDatabase({ driver }).bind(defineSchema({ form, field }))

    expect(() =>
      other.$compile(
        schema.form.where(columns => columns.fields.exists()).update({ name: "Survey" }),
      ),
    ).toThrow('Relation "form.fields" is not part of the schema')
  })

  it("rejects a bound query of another Db", () => {
    const { driver } = createRecordingDriver()
    const db = createDatabase({ driver }).bind(schema)
    const other = createDatabase({ driver }).bind(schema)

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
      ]) {
        expect(() => mutate(query)).toThrow(
          `${method} cannot sort or limit the rows it changes; choose them with where, find, or findBy instead of take, limit, offset, or orderBy`,
        )
      }
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

describe("execution", () => {
  /** Binds the schema to a database whose driver answers every statement with `rows`, reporting `count` rows. */
  function connect(count: number, rows: string[][] = []) {
    const { driver, statements } = createRecordingDriver({ respond: () => ({ count, rows }) })
    return { db: createDatabase({ driver }).bind(schema, { schemaName: "app" }), statements }
  }

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

  const db = database.bind(schema)

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

    const db = database.bind(boards)
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
