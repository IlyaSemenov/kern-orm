import { describe, expect, it } from "bun:test"

import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"
import { createDatabase, createStatement } from "kern-db"
import { startSqlQuery } from "kern-db/builder"

import { describePostgres } from "../../testing/postgres"
import { bindSchema } from "../execution/db"
import { defineSchema } from "../schema/schema"
import { toSnakeCase } from "../table/snake-case"
import { createTableFactory, defineTable, defineView } from "../table/table"
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

const schema = defineSchema({ queue, job, membership })

describe("columns", () => {
  const db = bindSchema(schema, createDatabase({ driver: createRecordingDriver().driver }))

  it("are all the columns of a table of a Db or of its definition, by their physical names, under their keys", () => {
    const text =
      '"id" AS "id", "queue_name" AS "queueName", "run_at" AS "runAt", "locked_by" AS "lockedBy"'

    expect(columnsOf(db.job).text).toBe(text)
    expect(columnsOf(job).text).toBe(text)
    expect(columnsOf(pendingJob).text).toBe('"id" AS "id", "note" AS "note"')
  })

  it("take an alias of the table, which is also the prefix of the result columns unless they take another, and the columns to select in their order", () => {
    expect(columnsOf(db.job, { alias: "j", columns: ["runAt", "id"] }).text).toBe(
      '"j"."run_at" AS "j__runAt", "j"."id" AS "j__id"',
    )
    expect(columnsOf(db.job, { alias: "j", prefix: "job", columns: ["id"] }).text).toBe(
      '"j"."id" AS "job__id"',
    )
    expect(columnsOf(db.job, { prefix: "job", columns: ["id"] }).text).toBe('"id" AS "job__id"')
  })

  it("keep the types of the columns in their fields", () => {
    expect(columnsOf(db.job, { columns: ["runAt"] }).fields).toEqual([
      { key: "runAt", column: "runAt", type: job.columns.runAt.type },
    ])
  })

  it("reject a query of the records of a table, another value, and a column that the table does not have", () => {
    expect(() => columnsOf(db.job.where({ id: 1 }))).toThrow(
      "columnsOf takes a table, such as db.form, not a query of its records; pass the table and keep the conditions of the query in the statement",
    )
    expect(() => columnsOf("job" as never)).toThrow(
      "columnsOf takes a table or view, such as db.form or its definition",
    )
    expect(() => columnsOf(db.job, { columns: ["task" as never] })).toThrow(
      'table "job" has no column "task"',
    )
    expect(() => columnsOf(db.job, { columns: [] })).toThrow(
      "Columns of a record must include at least one column",
    )
  })

  it("tell a missing row by the primary key when they include all its columns", () => {
    expect(columnsOf(db.job).nullable().presence).toEqual([0])
    expect(
      columnsOf(membership, { columns: ["role", "teamId", "userId"] }).nullable().presence,
    ).toEqual([2, 1])
    // @ts-expect-error Columns without the whole primary key take the columns in `by`.
    expect(() => columnsOf(membership, { columns: ["role", "teamId"] }).nullable()).toThrow(
      "nullable() tells a missing row by the key of the record",
    )
    // @ts-expect-error A view has no primary key.
    expect(() => columnsOf(pendingJob).nullable()).toThrow(
      "nullable() tells a missing row by the key of the record",
    )
    expect(columnsOf(pendingJob).nullable({ by: ["id"] }).presence).toEqual([0])
    // @ts-expect-error A column that can be `NULL` does not tell a missing row.
    expect(() => columnsOf(pendingJob).nullable({ by: ["note"] })).toThrow(
      'Column "note" is nullable, so its NULL does not tell a missing row of the record',
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
    const claimed = columnsOf(recorded.job, { alias: "j", columns: ["id", "queueName"] })

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
      const queueColumns = columnsOf(db.queue, { alias: "q" })
      const jobColumns = columnsOf(db.job, { alias: "j" }).nullable()

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
      const jobColumns = columnsOf(db.job, { alias: "j" })
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
})
