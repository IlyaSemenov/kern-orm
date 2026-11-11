import { describe, expect, it } from "bun:test"

import { describePostgres } from "../../../testing/database/postgres"
import { createRecordingDriver } from "../../../testing/database/recording-driver"
import { boolean } from "../codecs/boolean"
import { integer } from "../codecs/numeric"
import { text } from "../codecs/text"
import { createDatabase } from "../database"
import type { DriverResult } from "../driver"
import { NotFoundError } from "../result"

import { identifier, param } from "./fragment"
import type { AnySqlQuery } from "./query"
import { startSqlQuery } from "./query"

/** Database over a recording driver that answers every statement with `result`. */
function createRecordedDatabase(result: Partial<DriverResult> = {}) {
  const { driver, statements } = createRecordingDriver({ respond: () => result })
  return { database: createDatabase({ driver }), statements }
}

describe("statements", () => {
  it("execute on their database when awaited, resolving to the number of the rows of the command tag", async () => {
    const { database, statements } = createRecordedDatabase({ count: 3 })

    const count = await database.query`UPDATE form SET name = ${"Survey"} WHERE id > ${1}`

    expect(count).toBe(3)
    expect(statements).toEqual([
      {
        connection: "pool",
        text: "UPDATE form SET name = $1 WHERE id > $2",
        parameters: ["Survey", "1"],
      },
    ])
  })

  it("run in the ambient transaction", async () => {
    const { database, statements } = createRecordedDatabase()

    await database.transaction(async () => {
      await database.query`SELECT pg_advisory_xact_lock(${1})`
    })

    expect(statements.map(statement => statement.connection)).toEqual([1, 1, 1])
  })

  it("compile as they execute, interpolating fragments as SQL", () => {
    const { database } = createRecordedDatabase()
    const query = database.query`DELETE FROM ${identifier("app", "form")} WHERE ${identifier("id")} = ANY(${param(integer, 1)}, ${2})`

    expect(query.toSQL()).toEqual({
      text: 'DELETE FROM "app"."form" WHERE "id" = ANY(($1::integer), $2)',
      parameters: ["1", "2"],
    })
  })

  it("reject a value that the template does not take when they are created", () => {
    const { database } = createRecordedDatabase()

    // @ts-expect-error A parameter without a codec takes no object.
    expect(() => database.query`SELECT ${{ id: 1 }}`).toThrow(
      "A parameter without a codec takes a string",
    )
    // @ts-expect-error A parameter has no undefined.
    expect(() => database.query`SELECT ${undefined}`).toThrow(
      "Query parameter is undefined; use null for NULL",
    )
  })

  it("compile their statement each time they execute, rejecting without a statement when it fails to compile", async () => {
    const { database, statements } = createRecordedDatabase({ count: 1 })
    let compiled = 0
    const query = startSqlQuery(() => {
      compiled++
      if (compiled > 1) {
        throw new Error("Cannot compile")
      }
      return { text: "UPDATE form SET name = 'Survey'", parameters: [] }
    }, database)

    expect(await query).toBe(1)
    await expect(query.then()).rejects.toThrow("Cannot compile")
    expect(statements).toHaveLength(1)
  })
})

describe("rows", () => {
  const columns = ["name", "id", "note"]

  it("decode the result columns of the keys of select by their codecs, adding fields to those selected earlier", async () => {
    const { database } = createRecordedDatabase({
      columns,
      rows: [
        ["Survey", "1", "x"],
        ["Feedback", "2", null],
      ],
    })
    const query = database.query`SELECT * FROM form`.select({
      id: integer,
      name: text,
    })

    expect(await query).toEqual([
      { id: 1, name: "Survey" },
      { id: 2, name: "Feedback" },
    ])
    expect(
      await query.select({
        id: text,
        note: text.nullable(),
      }),
    ).toEqual([
      { id: "1", name: "Survey", note: "x" },
      { id: "2", name: "Feedback", note: null },
    ])
  })

  it("of select include a field that is not enumerable", async () => {
    const { database } = createRecordedDatabase({ columns: ["id"], rows: [["1"]] })
    const fields = Object.defineProperty({}, "id", { value: integer, enumerable: false })

    expect(await database.query`SELECT`.select(fields as { id: typeof integer })).toEqual([
      { id: 1 },
    ])
  })

  it("of take reject without a row and with several, unless optional or nullable allows no row", async () => {
    const fields = {
      id: integer,
    }
    const one = createRecordedDatabase({ columns, rows: [["Survey", "1", null]] }).database
    const none = createRecordedDatabase({ columns }).database
    const several = createRecordedDatabase({
      columns,
      rows: [
        ["Survey", "1", null],
        ["Feedback", "2", null],
      ],
    }).database

    expect(await one.query`SELECT`.select(fields).take()).toEqual({ id: 1 })
    expect(await one.query`SELECT`.take().select(fields)).toEqual({ id: 1 })
    await expect(Promise.resolve(none.query`SELECT`.select(fields).take())).rejects.toThrow(
      NotFoundError,
    )
    expect(await none.query`SELECT`.select(fields).take().optional()).toBeUndefined()
    expect(await none.query`SELECT`.select(fields).take().nullable()).toBeNull()
    await expect(
      Promise.resolve(several.query`SELECT`.select(fields).take().optional()),
    ).rejects.toThrow("Query of one row returned 2 rows")
  })

  it("of a statement without a selection are checked by take against its command tag", async () => {
    const count = (value: number) => createRecordedDatabase({ count: value }).database

    expect(await count(1).query`UPDATE`.take()).toBe(1)
    await expect(Promise.resolve(count(0).query`UPDATE`.take())).rejects.toThrow(NotFoundError)
    expect(await count(0).query`UPDATE`.take().optional()).toBe(0)
    await expect(Promise.resolve(count(2).query`UPDATE`.take())).rejects.toThrow(
      "Query of one row reported 2 rows",
    )
  })

  it("decode the value of the only column with get and pluck", async () => {
    const values = createRecordedDatabase({ columns: ["count"], rows: [["1"], ["2"]] }).database
    const none = createRecordedDatabase({ columns: ["count"] }).database

    expect(await values.query`SELECT`.pluck(integer)).toEqual([1, 2])
    expect(
      await createRecordedDatabase({ columns: ["count"], rows: [["1"]] }).database.query`SELECT`
        .take()
        .pluck(integer),
    ).toBe(1)
    await expect(Promise.resolve(values.query`SELECT`.get(integer))).rejects.toThrow(
      "Query of one row returned 2 rows",
    )
    await expect(Promise.resolve(none.query`SELECT`.get(integer))).rejects.toThrow(NotFoundError)
    expect(await none.query`SELECT`.get(integer).optional()).toBeUndefined()
  })

  it("reject select after get or pluck, nullable after them, optional of many rows, other values than codecs, and a key that cannot be a field", () => {
    const query: AnySqlQuery = createRecordedDatabase().database.query`SELECT`

    // @ts-expect-error Types reject select after get.
    expect(() => query.get(integer).select({ id: integer })).toThrow(
      "select cannot be used after get or pluck; call get or pluck to replace the value",
    )
    // @ts-expect-error Types reject nullable after get.
    expect(() => query.get(integer).nullable()).toThrow(
      "nullable applies only to a query of records; use optional after get or pluck",
    )
    expect(() => query.select({ id: integer }).optional()).toThrow(
      "optional applies only to a query of one row, such as one made by take",
    )
    // @ts-expect-error A string is not a codec.
    expect(() => query.get("integer")).toThrow("get takes a codec")
    // @ts-expect-error A string is not a codec.
    expect(() => query.select({ id: "integer" })).toThrow('field "id" takes a codec')
    expect(() => query.select({ [Symbol("id")]: integer } as never)).toThrow(
      "A selected field must have a string key",
    )
    expect(() => query.select(JSON.parse('{"__proto__": {}}') as never)).toThrow(
      'Field "__proto__" cannot be a key of a record',
    )
  })
})

describePostgres("in PostgreSQL", ({ database, testTransaction }) => {
  it("runs DDL and returns the rows of an upsert, decoded by the names of their columns", () =>
    testTransaction(async () => {
      expect(
        await database.query`CREATE TABLE form (id integer PRIMARY KEY, name text NOT NULL)`,
      ).toBe(0)
      await database.query`INSERT INTO form (id, name) VALUES (${1}, ${"Survey"})`

      const upserted = await database.query`
        INSERT INTO form (id, name) VALUES (${1}, ${"Feedback"}), (${2}, ${"Quiz"})
        ON CONFLICT (id) DO UPDATE SET name = excluded.name
        RETURNING name, id, (xmax = 0) AS inserted
      `.select({
        id: integer,
        name: text,
        inserted: boolean,
      })

      expect(upserted.toSorted((a, b) => a.id - b.id)).toEqual([
        { id: 1, name: "Feedback", inserted: false },
        { id: 2, name: "Quiz", inserted: true },
      ])
      expect(await database.query`SELECT count(*) FROM form`.get(integer)).toBe(2)
      expect(await database.query`DELETE FROM form WHERE id = ${2}`.take()).toBe(1)
    }))

  it("names a table by identifier whose name has a dot and a quote", () =>
    testTransaction(async () => {
      const table = identifier('form.v2 "draft"')
      await database.script`CREATE TABLE ${table} (name text)`

      expect(await database.query`INSERT INTO ${table} (name) VALUES (${"Survey"})`).toBe(1)
      expect(await database.query`SELECT name FROM ${table}`.pluck(text)).toEqual(["Survey"])
    }))
})
