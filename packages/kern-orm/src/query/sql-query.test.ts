import { describe, expect, it } from "bun:test"

import { describePostgres } from "../../testing/postgres"
import { createRecordingDriver } from "../../testing/recording-driver"
import { integer } from "../database/codecs/numeric"
import type { DriverResult } from "../database/driver"
import {
  identifier as identifierFragment,
  param as paramFragment,
  sql as sqlFragment,
} from "../database/sql/fragment"
import { createDatabase } from "../execution/database"
import { identifier, sql } from "../expression/sql"
import { NotFoundError } from "../result/result"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { AnySqlQuery } from "./sql-query"

const form = defineTable("form", {
  id: t.integer.primaryKey(),
  name: t.text,
})

const schema = defineSchema({ form })

/** Db of `schema` over a recording driver that answers every statement with `result`. */
function createDb(result: Partial<DriverResult> = {}) {
  const { driver, statements } = createRecordingDriver({ respond: () => result })
  const database = createDatabase({ driver })
  return { database, db: database.bind(schema, { schemaName: () => "app" }), statements }
}

describe("statements", () => {
  it("execute on their Db when awaited, resolving to the number of the rows of the command tag", async () => {
    const { db, statements } = createDb({ count: 3 })

    const count = await db.$query`UPDATE ${db.form} SET name = ${"Survey"} WHERE id > ${1}`

    expect(count).toBe(3)
    expect(statements).toEqual([
      {
        connection: "pool",
        text: 'UPDATE "app"."form" SET name = $1 WHERE id > $2',
        parameters: ["Survey", "1"],
      },
    ])
  })

  it("run in the ambient transaction", async () => {
    const { db, statements } = createDb()

    await db.$transaction(async () => {
      await db.$query`SELECT pg_advisory_xact_lock(${1})`
    })

    expect(statements.map(statement => statement.connection)).toEqual([1, 1, 1])
  })

  it("compile as their Db executes them", () => {
    const { db } = createDb()
    const query = db.$query`DELETE FROM ${schema.form} WHERE name = ${sql`lower(${"Survey"})`}`

    expect(query.toSQL()).toEqual({
      text: 'DELETE FROM "app"."form" WHERE name = lower($1)',
      parameters: ["Survey"],
    })
    expect(query.toSQL()).toEqual(db.$compile(query))
  })

  it("interpolate a fragment of the database layer as SQL, numbering its parameters with those of the statement", () => {
    const { db } = createDb()
    const condition = sqlFragment`${identifierFragment("id")} = ANY(${paramFragment(integer, 1)}, ${2})`

    const query = db.$query`DELETE FROM ${db.form} WHERE name = ${"Survey"} AND ${condition}`

    expect(query.toSQL()).toEqual({
      text: 'DELETE FROM "app"."form" WHERE name = $1 AND "id" = ANY(($2::integer), $3)',
      parameters: ["Survey", "1", "2"],
    })
  })

  it("reject a table of another Db and a table outside the schema of their Db", () => {
    const { database, db } = createDb()
    const other = defineTable("other", {
      id: t.integer,
    })

    expect(() => database.bind(schema).$query`SELECT FROM ${db.form}`.toSQL()).toThrow(
      'Table "form" interpolated into SQL is bound to another Db',
    )
    expect(() => db.$query`SELECT FROM ${defineSchema({ other }).other}`.toSQL()).toThrow(
      'Table "other" is not part of the schema',
    )
  })

  it("name a table by identifier as it is, keeping values as parameters", () => {
    const { db } = createDb()

    expect(
      db.$query`UPDATE ${identifier("tenant", "form")} SET name = ${"Survey"}`.toSQL(),
    ).toEqual({ text: 'UPDATE "tenant"."form" SET name = $1', parameters: ["Survey"] })
  })

  it("of the database run without a Db and name no tables of a Db", async () => {
    const { database, db, statements } = createDb({ count: 1 })

    expect(await database.query`SET LOCAL statement_timeout = ${"1s"}`).toBe(1)
    expect(statements).toEqual([
      { connection: "pool", text: "SET LOCAL statement_timeout = $1", parameters: ["1s"] },
    ])
    expect(() => database.query`SELECT FROM ${db.form}`.toSQL()).toThrow(
      'Table "form" interpolated into SQL is bound to another Db',
    )
    expect(() => database.query`SELECT FROM ${schema.form}`.toSQL()).toThrow(
      'Table "form" is not part of the schema',
    )
  })
})

describe("rows", () => {
  const columns = ["name", "id", "note"]

  it("decode the result columns of the keys of select by their types, adding fields to those selected earlier", async () => {
    const { db } = createDb({
      columns,
      rows: [
        ["Survey", "1", "x"],
        ["Feedback", "2", null],
      ],
    })
    const query = db.$query`SELECT * FROM ${db.form}`.select({
      id: t.integer,
      name: t.text,
    })

    expect(await query).toEqual([
      { id: 1, name: "Survey" },
      { id: 2, name: "Feedback" },
    ])
    expect(
      await query.select({
        id: t.text,
        note: t.text.nullable(),
      }),
    ).toEqual([
      { id: "1", name: "Survey", note: "x" },
      { id: "2", name: "Feedback", note: null },
    ])
  })

  it("of select include a field that is not enumerable", async () => {
    const { db } = createDb({ columns: ["id"], rows: [["1"]] })
    const fields = Object.defineProperty({}, "id", { value: t.integer, enumerable: false })

    expect(await db.$query`SELECT`.select(fields as { id: typeof t.integer })).toEqual([{ id: 1 }])
  })

  it("of take reject without a row and with several, unless optional or nullable allows no row", async () => {
    const fields = {
      id: t.integer,
    }
    const one = createDb({ columns, rows: [["Survey", "1", null]] }).db
    const none = createDb({ columns }).db
    const several = createDb({
      columns,
      rows: [
        ["Survey", "1", null],
        ["Feedback", "2", null],
      ],
    }).db

    expect(await one.$query`SELECT`.select(fields).take()).toEqual({ id: 1 })
    expect(await one.$query`SELECT`.take().select(fields)).toEqual({ id: 1 })
    await expect(Promise.resolve(none.$query`SELECT`.select(fields).take())).rejects.toThrow(
      NotFoundError,
    )
    expect(await none.$query`SELECT`.select(fields).take().optional()).toBeUndefined()
    expect(await none.$query`SELECT`.select(fields).take().nullable()).toBeNull()
    await expect(
      Promise.resolve(several.$query`SELECT`.select(fields).take().optional()),
    ).rejects.toThrow("Query of one row returned 2 rows")
  })

  it("of a statement without a selection are checked by take against its command tag", async () => {
    expect(await createDb({ count: 1 }).db.$query`UPDATE`.take()).toBe(1)
    await expect(Promise.resolve(createDb({ count: 0 }).db.$query`UPDATE`.take())).rejects.toThrow(
      NotFoundError,
    )
    expect(await createDb({ count: 0 }).db.$query`UPDATE`.take().optional()).toBe(0)
    await expect(Promise.resolve(createDb({ count: 2 }).db.$query`UPDATE`.take())).rejects.toThrow(
      "Query of one row reported 2 rows",
    )
  })

  it("decode the value of the only column with get and pluck", async () => {
    const values = createDb({ columns: ["count"], rows: [["1"], ["2"]] }).db
    const none = createDb({ columns: ["count"] }).db

    expect(await values.$query`SELECT`.pluck(t.integer)).toEqual([1, 2])
    expect(
      await createDb({ columns: ["count"], rows: [["1"]] }).db.$query`SELECT`
        .take()
        .pluck(t.integer),
    ).toBe(1)
    await expect(Promise.resolve(values.$query`SELECT`.get(t.integer))).rejects.toThrow(
      "Query of one row returned 2 rows",
    )
    await expect(Promise.resolve(none.$query`SELECT`.get(t.integer))).rejects.toThrow(NotFoundError)
    expect(await none.$query`SELECT`.get(t.integer).optional()).toBeUndefined()
  })

  it("reject select after get or pluck, nullable after them, optional of many rows, other values than types, and a key that cannot be a field", () => {
    const query: AnySqlQuery = createDb().db.$query`SELECT`

    // @ts-expect-error Types reject select after get.
    expect(() => query.get(t.integer).select({ id: t.integer })).toThrow(
      "select cannot be used after get or pluck; call get or pluck to replace the value",
    )
    // @ts-expect-error Types reject nullable after get.
    expect(() => query.get(t.integer).nullable()).toThrow(
      "nullable applies only to a query of records; use optional after get or pluck",
    )
    expect(() => query.select({ id: t.integer }).optional()).toThrow(
      "optional applies only to a query of one row, such as one made by take",
    )
    // @ts-expect-error A column is not a type.
    expect(() => query.get(form.columns.id)).toThrow(
      "get takes a type, such as t.integer, not a column or another value",
    )
    // @ts-expect-error A column is not a type.
    expect(() => query.select({ id: form.columns.id })).toThrow(
      'field "id" takes a type, such as t.integer, not a column or another value',
    )
    expect(() => query.select({ [Symbol("id")]: t.integer } as never)).toThrow(
      "A selected field must have a string key",
    )
    expect(() => query.select(JSON.parse('{"__proto__": {}}') as never)).toThrow(
      'Field "__proto__" cannot be a key of a record',
    )
  })

  it("cannot be a field or a value of a column", () => {
    const { db } = createDb()
    const query = db.$query`SELECT 1`.get(t.integer)

    expect(() => db.$select({ one: query as never })).toThrow(
      'Selected field "one" is a query of $query, which cannot be nested',
    )
    expect(() => db.form.insert({ id: 1, name: query as never })).toThrow(
      "An expression takes a query of one value of a table, such as of get, an aggregate, or exists, not a query of $query",
    )
  })
})

describePostgres("in PostgreSQL", ({ database, testTransaction }) => {
  const db = database.bind(schema)

  it("runs DDL and returns the rows of an upsert, decoded by the names of their columns", () =>
    testTransaction(async () => {
      expect(await db.$query`CREATE TABLE form (id integer PRIMARY KEY, name text NOT NULL)`).toBe(
        0,
      )
      await db.form.insert({ id: 1, name: "Survey" })

      const upserted = await db.$query`
        INSERT INTO ${db.form} (id, name) VALUES (${1}, ${"Feedback"}), (${2}, ${"Quiz"})
        ON CONFLICT (id) DO UPDATE SET name = excluded.name
        RETURNING name, id, (xmax = 0) AS inserted
      `.select({
        id: t.integer,
        name: t.text,
        inserted: t.boolean,
      })

      expect(upserted.toSorted((a, b) => a.id - b.id)).toEqual([
        { id: 1, name: "Feedback", inserted: false },
        { id: 2, name: "Quiz", inserted: true },
      ])
      expect(await db.$query`SELECT count(*) FROM ${db.form}`.get(t.integer)).toBe(2)
      expect(await db.$query`DELETE FROM ${db.form} WHERE id = ${2}`.take()).toBe(1)
    }))

  it("names a table by identifier whose name has a dot and a quote", () =>
    testTransaction(async () => {
      const table = identifier('form.v2 "draft"')
      await database.script`CREATE TABLE ${table} (name text)`

      expect(await database.query`INSERT INTO ${table} (name) VALUES (${"Survey"})`).toBe(1)
      expect(await database.query`SELECT name FROM ${table}`.pluck(t.text)).toEqual(["Survey"])
    }))
})
