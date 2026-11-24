import { describe, expect, it } from "bun:test"

import { getThrownError } from "@kern-orm/test-harness/errors"
import { describePostgres } from "@kern-orm/test-harness/postgres"
import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"

import { createDatabase } from "../database"
import type { DriverResult, SqlStatement, StatementExecutor } from "../driver"
import { isQueryError } from "../error-condition"
import { NotFoundError } from "../result"
import { array } from "../type/builtins/array"
import { boolean } from "../type/builtins/boolean"
import { timestamptz } from "../type/builtins/datetime"
import { integer } from "../type/builtins/numeric"
import { text } from "../type/builtins/text"

import { createSqlColumns } from "./columns"
import { identifier, param, sql } from "./fragment"
import type { AnySqlQuery } from "./query"
import { queryOn, startSqlQuery } from "./query"

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

  it("call execute of their database as it is when they run, also one replaced after they were created", async () => {
    const { database } = createRecordedDatabase()
    const { execute } = database
    const executed: string[] = []
    const query = database.query`SELECT 1`
    database.execute = statement => {
      executed.push(statement.text)
      return execute(statement)
    }

    await query

    expect(executed).toEqual(["SELECT 1"])
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

    // @ts-expect-error A parameter without a type takes no object.
    expect(() => database.query`SELECT ${{ id: 1 }}`).toThrow(
      "A parameter without a type takes a string",
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

describe("queryOn", () => {
  it("starts a query on a driver, which runs on the pool outside the transaction of a database over it", async () => {
    const { driver, statements } = createRecordingDriver({ respond: () => ({ count: 2 }) })
    const database = createDatabase({ driver })

    const count = await database.transaction(
      async () => await queryOn(driver)`UPDATE form SET name = ${"Survey"}`,
    )

    expect(count).toBe(2)
    expect(statements.map(statement => [statement.connection, statement.text])).toEqual([
      [1, "BEGIN"],
      ["pool", "UPDATE form SET name = $1"],
      [1, "COMMIT"],
    ])
  })

  it("starts a query on a connection", async () => {
    const { driver, statements } = createRecordingDriver({
      respond: () => ({ columns: [{ name: "id", type: 23 }], rows: [["1"], ["2"]] }),
    })
    const connection = await driver.acquire()

    const ids = await queryOn(connection)`SELECT id FROM form WHERE id < ${3}`.pluck(integer)
    await connection.release()

    expect(ids).toEqual([1, 2])
    expect(statements).toEqual([
      { connection: 1, text: "SELECT id FROM form WHERE id < $1", parameters: ["3"] },
    ])
  })

  it("starts a query on an object with execute, called as its method each time the query is awaited", async () => {
    class RecordingExecutor implements StatementExecutor {
      readonly statements: SqlStatement[] = []

      async execute(statement: SqlStatement): Promise<DriverResult> {
        this.statements.push(statement)
        return {
          command: "SELECT",
          count: 1,
          columns: [
            { name: "id", type: 23 },
            { name: "name", type: 25 },
          ],
          rows: [["1", "Survey"]],
        }
      }
    }
    const executor = new RecordingExecutor()
    const query = queryOn(executor)`SELECT id, name FROM form WHERE id = ${1}`
      .select({
        id: integer,
        name: text,
      })
      .take()

    expect(executor.statements).toEqual([])
    expect(await query).toEqual({ id: 1, name: "Survey" })
    expect(await query).toEqual({ id: 1, name: "Survey" })
    expect(executor.statements).toEqual([
      { text: "SELECT id, name FROM form WHERE id = $1", parameters: ["1"] },
      { text: "SELECT id, name FROM form WHERE id = $1", parameters: ["1"] },
    ])
  })

  it("starts a query on a database, which runs in its ambient transaction as its query does", async () => {
    const { database, statements } = createRecordedDatabase()

    await database.transaction(async () => {
      await queryOn(database)`SELECT pg_advisory_xact_lock(${1})`
    })

    expect(statements.map(statement => [statement.connection, statement.text])).toEqual([
      [1, "BEGIN"],
      [1, "SELECT pg_advisory_xact_lock($1)"],
      [1, "COMMIT"],
    ])
  })

  it("interpolates fragments with their values, binding a value at each place of its fragment and the parameter of a param once", () => {
    const { driver } = createRecordingDriver()
    const table = identifier("jobs", "job")
    const now = sql`coalesce(${param(timestamptz.nullable(), null)}, statement_timestamp())`
    const due = sql`state = ${"pending"} AND run_at <= ${now}`

    const query = queryOn(
      driver,
    )`/* claim */ UPDATE ${table} SET locked_at = ${now}, locked_by = ${"worker"} WHERE ${due} AND id = ANY(${param(array(integer), [1, 2])})`

    expect(query.toSQL()).toEqual({
      text: '/* claim */ UPDATE "jobs"."job" SET locked_at = coalesce(($1::timestamptz), statement_timestamp()), locked_by = $2 WHERE state = $3 AND run_at <= coalesce(($1::timestamptz), statement_timestamp()) AND id = ANY(($4::integer[]))',
      parameters: [null, "worker", "pending", '{"1","2"}'],
    })
  })

  it("rejects a value that the template does not take when the query is created", () => {
    const { driver } = createRecordingDriver()

    // @ts-expect-error A parameter without a type takes no array.
    expect(getThrownError(() => queryOn(driver)`SELECT ${[1]}`)).toEqual(
      new TypeError(
        "A parameter without a type takes a string, a number, a bigint, a boolean, null, a Date, or a Uint8Array, not an array; pass JSON or an array with param()",
      ),
    )
  })

  it("rejects a value without an execute method, such as the strings of a template without an executor", () => {
    const error = new TypeError(
      "queryOn() takes an object with an execute method, such as a database, a driver, or a connection, and returns the template of a statement: queryOn(executor)`SELECT 1`",
    )

    // @ts-expect-error The strings of a template are not an executor.
    expect(getThrownError(() => queryOn`SELECT 1`)).toEqual(error)
    // @ts-expect-error An object without `execute` is not an executor.
    expect(getThrownError(() => queryOn({ query: () => {} }))).toEqual(error)
    // @ts-expect-error `undefined` is not an executor.
    expect(getThrownError(() => queryOn(undefined))).toEqual(error)
  })
})

describe("rows", () => {
  const columns = ["name", "id", "note"].map(name => ({ name, type: 25 }))

  it("decode the result columns of the keys of select by their types, adding fields to those selected earlier", async () => {
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
    const { database } = createRecordedDatabase({
      columns: [{ name: "id", type: 25 }],
      rows: [["1"]],
    })
    const fields = Object.defineProperty({}, "id", { value: integer, enumerable: false })

    expect(await database.query`SELECT`.select(fields as { id: typeof integer })).toEqual([
      { id: 1 },
    ])
  })

  describe("of the columns of records", () => {
    const job = createSqlColumns(
      [
        { key: "id", name: "id", type: integer },
        { key: "runAt", name: "run_at", type: text },
      ],
      { alias: "j", prefix: "job", key: ["id"] },
    )
    const queue = createSqlColumns([{ key: "id", name: "id", type: integer }], { alias: "q" })
    const result = {
      columns: ["q__id", "job__runAt", "lag", "job__id"].map(name => ({ name, type: 25 })),
      rows: [
        ["7", "noon", "5", "1"],
        ["8", null, "6", null],
      ],
    }

    it("are records of their own under the keys of select, read from their result columns, beside the fields of types, and null of nullable columns without their row", async () => {
      const { database, statements } = createRecordedDatabase(result)

      const rows = await database.query`
        SELECT ${queue}, ${job}, q.id - 2 AS lag FROM queue q LEFT JOIN job j ON j.queue_id = q.id
      `.select({
        job: job.nullable(),
        lag: integer,
        queue,
      })

      expect(rows).toEqual([
        { job: { id: 1, runAt: "noon" }, lag: 5, queue: { id: 7 } },
        { job: null, lag: 6, queue: { id: 8 } },
      ])
      expect(statements[0]!.text).toContain(
        'SELECT "q"."id" AS "q__id", "j"."id" AS "job__id", "j"."run_at" AS "job__runAt", q.id - 2 AS lag FROM queue q',
      )
    })

    it("are replaced as a whole under their key, by other columns or by a type", async () => {
      const { database } = createRecordedDatabase(result)
      const query = database.query`SELECT`.select({
        job: job.nullable(),
        lag: integer,
      })

      expect(
        await query.select({
          job: queue,
        }),
      ).toEqual([
        { lag: 5, job: { id: 7 } },
        { lag: 6, job: { id: 8 } },
      ])
      expect(
        await database.query`SELECT`
          .select({
            lag: queue,
          })
          .select({
            lag: integer,
          }),
      ).toEqual([{ lag: 5 }, { lag: 6 }])
    })

    it("reject fields that read one result column", () => {
      const { database } = createRecordedDatabase()
      const query = database.query`SELECT`
      const unprefixed = createSqlColumns([{ key: "id", name: "id", type: integer }])

      expect(() =>
        query.select({
          id: integer,
          queue: unprefixed,
        }),
      ).toThrow(
        'Fields "id" and "queue.id" read one result column "id"; give the columns of records prefixes that make the names of their result columns differ',
      )
      expect(() =>
        query
          .select({
            queue,
          })
          .select({
            other: queue,
          }),
      ).toThrow('Fields "queue.id" and "other.id" read one result column "q__id"')
      expect(() =>
        query.select({
          job__id: integer,
          job,
        }),
      ).toThrow('Fields "job__id" and "job.id" read one result column "job__id"')
    })
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
    const values = createRecordedDatabase({
      columns: [{ name: "count", type: 25 }],
      rows: [["1"], ["2"]],
    }).database
    const none = createRecordedDatabase({ columns: [{ name: "count", type: 25 }] }).database

    expect(await values.query`SELECT`.pluck(integer)).toEqual([1, 2])
    expect(
      await createRecordedDatabase({
        columns: [{ name: "count", type: 25 }],
        rows: [["1"]],
      }).database.query`SELECT`
        .take()
        .pluck(integer),
    ).toBe(1)
    await expect(Promise.resolve(values.query`SELECT`.get(integer))).rejects.toThrow(
      "Query of one row returned 2 rows",
    )
    await expect(Promise.resolve(none.query`SELECT`.get(integer))).rejects.toThrow(NotFoundError)
    expect(await none.query`SELECT`.get(integer).optional()).toBeUndefined()
  })

  it("reject select after get or pluck, nullable after them, optional of many rows, other values than types, and a key that cannot be a field", () => {
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
    // @ts-expect-error A string is not a type.
    expect(() => query.get("integer")).toThrow("get takes a type")
    // @ts-expect-error A string is not a type.
    expect(() => query.select({ id: "integer" })).toThrow(
      'field "id" takes a type or the columns of a record',
    )
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

  it("types a value by its place, as text in the select list alone, and reads the same param in the select list, a subquery, and IS NULL", () =>
    testTransaction(async () => {
      const at = new Date("2026-01-15T07:00:00.000Z")
      const now = sql`coalesce(${at}, statement_timestamp())`

      // The other argument of coalesce types the value, at each place of the fragment.
      expect(
        await queryOn(database)`SELECT ${now} = ${now} AND ${now} = ${at}::timestamptz`.get(
          boolean,
        ),
      ).toBe(true)
      // A value that only the select list reads is text, OID 25.
      const selected = await database.execute(queryOn(database)`SELECT ${"mail"} AS queue`.toSQL())
      expect(selected.columns).toMatchObject([{ name: "queue", type: 25 }])
      // The condition alone does not type the value.
      const rejection: unknown = await database
        // A transaction of its own, so that the failed statement leaves the test transaction usable.
        .transaction(async () => await queryOn(database)`SELECT ${at} IS NULL`)
        .catch((error: unknown) => error)
      expect(isQueryError(rejection, "indeterminate_datatype")).toBe(true)
      const queue = param(text, "mail")
      expect(
        await queryOn(
          database,
        )`SELECT ${queue} AS selected, (SELECT ${queue}) AS nested, ${queue} IS NULL AS missing`
          .select({
            selected: text,
            nested: text,
            missing: boolean,
          })
          .take(),
      ).toEqual({ selected: "mail", nested: "mail", missing: false })
    }))

  it("groups by an expression of a param that the select list repeats", () =>
    testTransaction(async () => {
      const size = param(integer, 10)
      const bucket = sql`position / ${size}`

      expect(
        await database.query`
          SELECT ${bucket} AS bucket, count(*) AS total
          FROM generate_series(1, 25) AS position
          GROUP BY ${bucket}
          ORDER BY ${bucket}
        `.select({
          bucket: integer,
          total: integer,
        }),
      ).toEqual([
        { bucket: 0, total: 9 },
        { bucket: 1, total: 10 },
        { bucket: 2, total: 6 },
      ])
    }))

  it("names a table by identifier whose name has a dot and a quote", () =>
    testTransaction(async () => {
      const table = identifier('form.v2 "draft"')
      await database.script`CREATE TABLE ${table} (name text)`

      expect(await database.query`INSERT INTO ${table} (name) VALUES (${"Survey"})`).toBe(1)
      expect(await database.query`SELECT name FROM ${table}`.pluck(text)).toEqual(["Survey"])
    }))
})
