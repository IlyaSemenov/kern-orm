import { describe, expect, it } from "bun:test"

import { getThrownError } from "@kern-orm/test-harness/errors"
import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"
import type { SqlStatement } from "kern-db"
import { createDatabase, createStatement, identifier, param, queryOn, sql } from "kern-db"
import { startSqlQuery } from "kern-db/builder"

import { describePostgres } from "../../testing/postgres"
import { bindSchema } from "../execution/db"
import { defineSchema } from "../schema/schema"
import { toSnakeCase } from "../table/snake-case"
import { createTableFactory, defineTable, defineView } from "../table/table"
import { defineType } from "../type/type"
import * as t from "../types"

import { columnsOf } from "./columns-of"

const { defineTable: defineSnakeCaseTable } = createTableFactory({ columnName: toSnakeCase })

const queue = defineTable("queue", {
  name: t.text.primaryKey(),
})

const job = defineSnakeCaseTable("job", {
  id: t.integer.primaryKey(),
  queueName: t.text,
  runAt: t.timestamptz,
  lockedBy: t.text.nullable(),
})

const membership = defineTable(
  "membership",
  {
    userId: t.integer,
    teamId: t.integer,
    role: t.text,
  },
  { primaryKey: ["userId", "teamId"] },
)

const pendingJob = defineView("pending_job", {
  id: t.integer,
  note: t.text.nullable(),
})

/** Point in time read as seconds since the epoch, whose text does not depend on `DateStyle`. */
const epoch = defineType({
  sqlType: "timestamptz",
  read: value => `extract(epoch from ${value})`,
}).transform({
  decode: text => new Date(Math.round(Number(text) * 1000)),
  encode: (value: Date) => value.toISOString(),
})

const event = defineTable("event", {
  id: t.integer.primaryKey(),
  at: epoch,
})

const schema = defineSchema({ queue, job, membership, event })

describe("columns", () => {
  const db = bindSchema(schema, createDatabase({ driver: createRecordingDriver().driver }))

  it('of "*" are all the columns of a table of a Db or of its definition, by their physical names, under their keys', () => {
    const text =
      '"id" AS "id", "queue_name" AS "queueName", "run_at" AS "runAt", "locked_by" AS "lockedBy"'

    expect(columnsOf(db.job, "*").text).toBe(text)
    expect(columnsOf(job, "*").text).toBe(text)
    expect(columnsOf(pendingJob, "*").text).toBe('"id" AS "id", "note" AS "note"')
  })

  it("take an alias of the table, which is also the prefix of the result columns unless they take another, and the columns to select in their order", () => {
    expect(columnsOf(db.job, ["runAt", "id"], { alias: "j" }).text).toBe(
      '"j"."run_at" AS "j__runAt", "j"."id" AS "j__id"',
    )
    expect(columnsOf(db.job, ["id"], { alias: "j", prefix: "job" }).text).toBe(
      '"j"."id" AS "job__id"',
    )
    expect(columnsOf(db.job, ["id"], { prefix: "job" }).text).toBe('"id" AS "job__id"')
  })

  it("select a column of a type with a read expression by the expression", () => {
    expect(columnsOf(event, "*", { alias: "e" }).text).toBe(
      '"e"."id" AS "e__id", extract(epoch from "e"."at") AS "e__at"',
    )
  })

  it("keep the types of the columns in their fields", () => {
    expect(columnsOf(db.job, ["runAt"]).fields).toEqual([
      { key: "runAt", column: "runAt", type: job.columns.runAt.type },
    ])
  })

  it('reject a query of the records of a table, another value, columns that are neither "*" nor a list, and a column that the table does not have', () => {
    expect(getThrownError(() => columnsOf(db.job.where({ id: 1 }), "*"))).toEqual(
      new TypeError(
        "columnsOf takes a table, such as db.form, not a query of its records; pass the table and keep the conditions of the query in the statement",
      ),
    )
    expect(getThrownError(() => columnsOf("job" as never, "*"))).toEqual(
      new TypeError("columnsOf takes a table or view, such as db.form or its definition"),
    )
    expect(getThrownError(() => columnsOf(db.job, "id" as never))).toEqual(
      new TypeError('columnsOf takes "*" or an array of column keys as its second argument'),
    )
    expect(getThrownError(() => columnsOf(db.job, ["task" as never]))).toEqual(
      new Error('table "job" has no column "task"'),
    )
    expect(getThrownError(() => columnsOf(db.job, []))).toEqual(
      new Error("Columns of a record must include at least one column"),
    )
  })

  it("tell a missing row by the primary key when they include all its columns", () => {
    const missingKey = new Error(
      "nullable() tells a missing row by the key of the record, which these columns do not include; pass the columns that are never NULL in a row in `by`",
    )

    expect(columnsOf(db.job, "*").nullable().presence).toEqual([0])
    expect(columnsOf(membership, ["role", "teamId", "userId"]).nullable().presence).toEqual([2, 1])
    // @ts-expect-error Columns without the whole primary key take the columns in `by`.
    expect(getThrownError(() => columnsOf(membership, ["role", "teamId"]).nullable())).toEqual(
      missingKey,
    )
    // @ts-expect-error A view has no primary key.
    expect(getThrownError(() => columnsOf(pendingJob, "*").nullable())).toEqual(missingKey)
    expect(columnsOf(pendingJob, "*").nullable({ by: ["id"] }).presence).toEqual([0])
    // @ts-expect-error A column that can be `NULL` does not tell a missing row.
    expect(getThrownError(() => columnsOf(pendingJob, "*").nullable({ by: ["note"] }))).toEqual(
      new Error('Column "note" is nullable, so its NULL does not tell a missing row of the record'),
    )
  })

  it("are selected by a statement of $query and read as records of select", async () => {
    const { driver, statements } = createRecordingDriver({
      respond: () => ({
        columns: ["j__id", "j__queueName", "lag"].map(name => ({ name, type: 25 })),
        rows: [["1", "mail", "5"]],
      }),
    })
    const recorded = bindSchema(schema, createDatabase({ driver }), { schemaName: "app" })
    const claimed = columnsOf(recorded.job, ["id", "queueName"], { alias: "j" })

    const rows = await recorded.$query`
      UPDATE ${recorded.job} j SET locked_by = ${"worker"} RETURNING ${claimed}, 5 AS lag
    `.select({
      job: claimed,
      lag: t.integer,
    })

    expect(rows).toEqual([{ job: { id: 1, queueName: "mail" }, lag: 5 }])
    expect(statements[0]).toMatchObject({
      text: expect.stringContaining(
        'UPDATE "app"."job" j SET locked_by = $1 RETURNING "j"."id" AS "j__id", "j"."queue_name" AS "j__queueName", 5 AS lag',
      ),
      parameters: ["worker"],
    })
  })
})

describePostgres("in PostgreSQL", ({ database, testTransaction, useTestFixture }) => {
  useTestFixture(() =>
    database.script(`
      CREATE TABLE queue (name text PRIMARY KEY);
      INSERT INTO queue VALUES ('mail'), ('idle');
      CREATE TABLE job (
        id integer PRIMARY KEY,
        queue_name text NOT NULL,
        run_at timestamptz NOT NULL,
        locked_by text
      );
      INSERT INTO job VALUES (1, 'mail', '2026-01-15T07:00:00Z', NULL);
    `),
  )

  const db = bindSchema(schema, database)

  it("reads the records of two tables of an outer join, null without the row of the joined one", () =>
    testTransaction(async () => {
      const queueColumns = columnsOf(db.queue, "*", { alias: "q" })
      const jobColumns = columnsOf(db.job, "*", { alias: "j" }).nullable()

      const rows = await db.$query`
        SELECT ${queueColumns}, ${jobColumns}, j.id IS NOT NULL AS claimed
        FROM ${db.queue} q LEFT JOIN ${db.job} j ON j.queue_name = q.name
        ORDER BY q.name
      `.select({
        queue: queueColumns,
        job: jobColumns,
        claimed: t.boolean,
      })

      expect(rows).toEqual([
        { queue: { name: "idle" }, job: null, claimed: false },
        {
          queue: { name: "mail" },
          job: { id: 1, queueName: "mail", runAt: "2026-01-15T07:00:00.000000Z", lockedBy: null },
          claimed: true,
        },
      ])
    }))

  it("reads the record that a statement built as text returns, selected by the text of the columns", () =>
    testTransaction(async () => {
      const jobColumns = columnsOf(db.job, "*", { alias: "j" })
      const statement = createStatement(
        `WITH claimed AS (
           UPDATE job j SET locked_by = $1 WHERE j.id = $2::text::integer
           RETURNING ${jobColumns.text}
         )
         SELECT * FROM claimed`,
        ["worker", "1"],
      )

      const row = await startSqlQuery(() => statement, database)
        .select({
          job: jobColumns,
        })
        .take()

      expect(row.job).toMatchObject({ id: 1, queueName: "mail", lockedBy: "worker" })
    }))

  it("reads the records of a claim that a template of queryOn runs on a wrapper of execute, with the values that it binds", () =>
    testTransaction(async () => {
      const jobColumns = columnsOf(db.job, ["id", "queueName", "lockedBy"], { alias: "j" })
      const sent: string[] = []
      const timed = {
        execute(statement: SqlStatement) {
          sent.push(statement.text)
          return database.execute(statement)
        },
      }
      const now = sql`coalesce(${new Date("2026-01-15T07:00:05Z")}, statement_timestamp())`

      const claims = await queryOn(timed)`
        /* claim */ WITH due AS (
          SELECT id FROM ${identifier("job")}
          WHERE run_at <= ${now} AND id = ANY(${param(t.array(t.integer), [1, 2])})
          FOR UPDATE SKIP LOCKED
        )
        UPDATE job j SET locked_by = ${"worker"} FROM due WHERE j.id = due.id
        RETURNING ${jobColumns}, extract(epoch FROM ${now} - j.run_at)::float8 AS lag
      `.select({
        job: jobColumns,
        lag: t.doublePrecision,
      })

      expect(claims).toEqual([{ job: { id: 1, queueName: "mail", lockedBy: "worker" }, lag: 5 }])
      expect(sent).toEqual([expect.stringContaining("/* claim */ WITH due AS")])
    }))

  it("reads a column of a type with a read expression whatever the DateStyle of the session", () =>
    testTransaction(async () => {
      await database.script(`
        SET LOCAL DateStyle = 'SQL, DMY';
        CREATE TABLE event (id integer PRIMARY KEY, at timestamptz NOT NULL);
        INSERT INTO event VALUES (1, '2026-01-15T07:00:00.123Z');
      `)
      const eventColumns = columnsOf(db.event, "*", { alias: "e" }).nullable()

      const rows = await db.$query`
        SELECT ${eventColumns}
        FROM generate_series(1, 2) AS n LEFT JOIN ${db.event} e ON e.id = n
        ORDER BY n
      `.select({
        event: eventColumns,
      })

      expect(rows).toEqual([
        { event: { id: 1, at: new Date("2026-01-15T07:00:00.123Z") } },
        { event: null },
      ])
    }))
})
