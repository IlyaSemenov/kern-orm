import { expect, test } from "bun:test"

import { bindSchema, defineSchema, defineTable, many, param, sql } from "kern-orm"
import * as t from "kern-orm/types"

import { describePostgres } from "../testing/postgres"

const queue = defineTable("queue", {
  id: t.integer.primaryKey(),
})

const job = defineTable("job", {
  id: t.integer.primaryKey(),
  queueId: t.integer.columnName("queue_id"),
  lockedAt: t.timestamptzPortable.nullable().columnName("locked_at"),
})

const schema = defineSchema({ queue, job }).$relations({
  queue: {
    jobs: many(job, { from: "id", to: "queueId" }),
  },
})

describePostgres(
  "timestamptzPortable in PostgreSQL",
  ({ database, testTransaction, useTestFixture }) => {
    const db = bindSchema(schema, database)

    useTestFixture(() =>
      database.script(`
        CREATE TABLE queue (id integer PRIMARY KEY);
        CREATE TABLE job (id integer PRIMARY KEY, queue_id integer NOT NULL, locked_at timestamptz);
        INSERT INTO queue VALUES (1), (2);
        INSERT INTO job VALUES
          (1, 1, '1969-12-31 23:59:59.999999+00'),
          (2, 1, NULL),
          (3, 2, '0044-03-15 12:00:00+00 BC');
      `),
    )

    test("reads the transaction clock and nullable nested fields, and binds them as the same instants after DateStyle and TimeZone change", async () => {
      const read = await testTransaction(async () => {
        await database.script(
          `SET LOCAL DateStyle = 'SQL, DMY'; SET LOCAL TimeZone = 'Asia/Kathmandu'`,
        )
        return {
          queues: await db.queue
            .select(queue => ({
              id: queue.id,
              clock: sql(t.timestamptzPortable)`transaction_timestamp()`,
              jobs: queue.jobs.select("id", "lockedAt").orderBy("id"),
            }))
            .orderBy("id"),
          // The same clock read independently, which the bound clock is compared with after the settings change.
          clock: await db.$query`
            SELECT to_char(transaction_timestamp() AT TIME ZONE INTERVAL '00:00', 'YYYY-MM-DD HH24:MI:SS.US')
          `.get(t.text),
        }
      })

      const clock = read.queues[0]!.clock
      expect(clock).toBe(`${read.clock.replace(" ", "T")}Z`)
      expect(read.queues).toEqual([
        {
          id: 1,
          clock,
          jobs: [
            { id: 1, lockedAt: "1969-12-31T23:59:59.999999Z" },
            { id: 2, lockedAt: null },
          ],
        },
        {
          id: 2,
          clock,
          jobs: [{ id: 3, lockedAt: "-000043-03-15T12:00:00.000000Z" }],
        },
      ])

      const bound = await testTransaction(async () => {
        await database.script(
          `SET LOCAL DateStyle = 'German, YMD'; SET LOCAL TimeZone = 'America/St_Johns'`,
        )
        const matches: number[][] = []
        for (const { jobs } of read.queues) {
          for (const { lockedAt } of jobs) {
            matches.push(await db.job.where({ lockedAt }).pluck("id").orderBy("id"))
          }
        }
        return {
          matches,
          clock: await db.$query`
            SELECT ${param(t.timestamptzPortable, clock)} = ${`${read.clock}+00`}::timestamptz
          `.get(t.boolean),
        }
      })

      expect(bound).toEqual({ matches: [[1], [2], [3]], clock: true })
    })
  },
)
