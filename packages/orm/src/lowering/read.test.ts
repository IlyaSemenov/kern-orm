import { describe, expect, it } from "bun:test"

import { describePostgres } from "../../testing/postgres"
import { createRef } from "../ast/testing"
import { bindSchema } from "../execution/db"
import { count, max } from "../expression/aggregates"
import { coalesce } from "../expression/functions"
import { orderingOperators } from "../expression/operators/ordering"
import { param, sql } from "../expression/sql"
import { desc } from "../query/order"
import { from } from "../query/select"
import { many } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import { defineType } from "../type/type"
import * as t from "../types"

import { readFields, readValue } from "./read"
import { lower } from "./testing"

/** Point in time read as seconds since the epoch, whose text does not depend on `DateStyle`. */
const epoch = defineType({
  sqlType: "timestamptz",
  read: value => `extract(epoch from ${value})`,
})
  .transform({
    decode: text => new Date(Math.round(Number(text) * 1000)),
    encode: (value: Date) => value.toISOString(),
  })
  .withOperators(orderingOperators)

/** Integer read with its sign changed, so that the order of its read values is the reverse of the order of its values. */
const negated = defineType({
  sqlType: "integer",
  read: value => `-${value}`,
})
  .transform({ decode: text => -Number(text), encode: (value: number) => String(value) })
  .withOperators(orderingOperators)

const queue = defineTable("queue", {
  id: t.integer.primaryKey(),
})

const job = defineTable("job", {
  id: t.integer.primaryKey(),
  queueId: t.integer.columnName("queue_id"),
  priority: negated,
  runAt: epoch.columnName("run_at"),
  lockedAt: epoch.nullable().columnName("locked_at"),
})

const schema = defineSchema({ queue, job }).$relations({
  queue: {
    jobs: many(job, { from: "id", to: "queueId" }),
  },
})

const date = new Date("2026-01-15T07:00:00.123Z")

describe("readValue", () => {
  const runAt = createRef(from(job).node.from, "runAt")

  it("reads a value of a type with a read expression by it, and keeps a value of another type", () => {
    expect(readValue(runAt, epoch)).toEqual({ kind: "read", operand: runAt, type: epoch })
    expect(readValue(runAt, t.timestamptz)).toBe(runAt)
  })
})

describe("readFields", () => {
  it("keeps fields without a type with a read expression as they are", () => {
    const { projections } = lower(schema.job.select("id", "queueId"))

    expect(readFields(projections)).toBe(projections)
  })

  it("reads the scalars of types with read expressions, and keeps the other scalars and nested rows", () => {
    const { projections } = lower(
      schema.queue.select(queue => ({
        id: queue.id,
        last: queue.jobs.max("runAt"),
        jobs: queue.jobs.pluck("runAt"),
      })),
    )
    const fields = readFields(projections)

    expect(fields[0]).toBe(projections[0]!)
    expect(fields[1]).toEqual({
      key: "last",
      expression: { kind: "read", operand: projections[1]!.expression, type: epoch },
      type: epoch,
    })
    expect(fields[2]).toBe(projections[2]!)
  })
})

describe("fields of a result", () => {
  it("are selected by the read expressions of their types in the select list of an executed query", () => {
    expect(schema.job.select("id", "runAt").toSQL().text).toBe(
      'SELECT "job"."id" AS "id", extract(epoch from "job"."run_at") AS "runAt" FROM "job" AS "job"',
    )
    expect(schema.job.find(1).get("lockedAt").toSQL().text).toBe(
      'SELECT extract(epoch from "job"."locked_at") AS "lockedAt" FROM "job" AS "job" WHERE "job"."id" = $1',
    )
    expect(schema.$select({ at: param(epoch, date) }).toSQL().text).toBe(
      'SELECT extract(epoch from ($1::timestamptz)) AS "at"',
    )
  })

  it("are selected by the read expressions in RETURNING, also of an update without values", () => {
    expect(
      schema.job
        .insert({ id: 1, queueId: 1, priority: 1, runAt: date })
        .select("id", "runAt")
        .toSQL().text,
    ).toEndWith(' RETURNING "job"."id" AS "id", extract(epoch from "job"."run_at") AS "runAt"')
    expect(schema.job.find(1).delete().get("runAt").toSQL().text).toEndWith(
      ' RETURNING extract(epoch from "job"."run_at") AS "runAt"',
    )
    expect(schema.job.find(1).update({}).select("lockedAt").toSQL().text).toBe(
      'SELECT extract(epoch from "job"."locked_at") AS "lockedAt" FROM "job" AS "job" WHERE "job"."id" = $1',
    )
  })

  it("read the value of an aggregate, also of a nested aggregate query, over its statement", () => {
    expect(schema.job.max("runAt").toSQL().text).toBe(
      'SELECT extract(epoch from max("job"."run_at")) AS "max" FROM "job" AS "job"',
    )
    expect(
      schema.queue
        .select(queue => ({
          last: queue.jobs.max("runAt"),
        }))
        .toSQL().text,
    ).toBe(
      'SELECT extract(epoch from (SELECT max("job"."run_at") AS "max" FROM "job" AS "job" WHERE "job"."queue_id" = "queue"."id")) AS "last" FROM "queue" AS "queue"',
    )
  })

  it("read an average in the PostgreSQL type of its value, which is wider than the type", () => {
    expect(schema.job.avg("priority").toSQL().text).toBe(
      'SELECT -avg("job"."priority") AS "avg" FROM "job" AS "job"',
    )
  })

  it("read an expression in parentheses, which the read expression may place beside an operator", () => {
    expect(
      schema.job
        .select(job => ({
          at: sql(epoch)`${job.runAt} + interval '1 day'`,
        }))
        .toSQL().text,
    ).toBe(
      `SELECT extract(epoch from ("job"."run_at" + interval '1 day')) AS "at" FROM "job" AS "job"`,
    )
  })

  it("are read once in packed nested rows, after the test of NULL of the value itself", () => {
    const { text } = schema.queue
      .select(queue => ({
        jobs: queue.jobs.select("runAt").orderBy("runAt"),
      }))
      .toSQL()

    expect(text).toBe(
      `SELECT (SELECT coalesce(json_agg(json_build_array(CASE WHEN "subquery"."runAt" IS NOT DISTINCT FROM NULL THEN NULL ELSE format('%s', extract(epoch from "subquery"."runAt")) END) ORDER BY "subquery"."runAt"), '[]'::json) AS "rows" FROM (SELECT "job"."run_at" AS "runAt" FROM "job" AS "job" WHERE "job"."queue_id" = "queue"."id") AS "subquery") AS "jobs" FROM "queue" AS "queue"`,
    )
  })

  it("keep their PostgreSQL type where a statement computes with them", () => {
    expect(
      schema.job
        .where(job => job.runAt.lt(date))
        .select("id")
        .toSQL().text,
    ).toEndWith(' WHERE "job"."run_at" < $1')
    expect(
      schema.job
        .where(job => job.runAt.eq(schema.job.max("runAt")))
        .select("id")
        .toSQL().text,
    ).toEndWith(
      ' WHERE "job"."run_at" = (SELECT max("job_2"."run_at") AS "max" FROM "job" AS "job_2")',
    )
    expect(
      schema.job
        .where(job => job.runAt.in(schema.job.pluck("runAt")))
        .select("id")
        .toSQL().text,
    ).toEndWith(' IN (SELECT "job_2"."run_at" AS "runAt" FROM "job" AS "job_2")')
    expect(lower(schema.job.select("runAt")).projections[0]!.expression.kind).toBe("column")
  })
})

describe("order and keys", () => {
  it("sort by a selected column itself rather than by the position of its read field", () => {
    expect(schema.job.select("id", "runAt").orderBy("runAt", "id").toSQL().text).toEndWith(
      ' FROM "job" AS "job" ORDER BY "job"."run_at", 1',
    )
  })

  it("group by a selected column itself, also as a key of distinctOn", () => {
    expect(
      schema.job
        .groupBy("runAt")
        .select(job => ({
          runAt: job.runAt,
          jobs: count(),
        }))
        .toSQL().text,
    ).toBe(
      'SELECT extract(epoch from "job"."run_at") AS "runAt", count(*) AS "jobs" FROM "job" AS "job" GROUP BY "job"."run_at"',
    )
    expect(
      schema.job
        .distinctOn("runAt")
        .select("runAt", "id")
        .orderBy(job => [job.runAt, desc(job.id)])
        .toSQL().text,
    ).toBe(
      'SELECT DISTINCT ON ("job"."run_at") extract(epoch from "job"."run_at") AS "runAt", "job"."id" AS "id" FROM "job" AS "job" ORDER BY "job"."run_at", 2 DESC',
    )
  })

  it("sort the rows of a page after an offset by the column of its derived source", () => {
    const { text } = schema.job
      .select(job => ({
        runAt: job.runAt,
        queues: schema.queue.where(queue => queue.id.eq(job.queueId)).pluck("id"),
      }))
      .orderBy("runAt")
      .offset(5)
      .toSQL()

    expect(text).toStartWith('SELECT extract(epoch from "job"."runAt") AS "runAt", (SELECT ')
    expect(text).toEndWith(
      ' FROM (SELECT "job_2"."run_at" AS "runAt", "job_2"."queue_id" AS "queueId" FROM "job" AS "job_2" ORDER BY 1 OFFSET $1) AS "job" ORDER BY "job"."runAt"',
    )
  })

  it("read the rows of distinct from a derived source, which compares and sorts the values themselves", () => {
    expect(schema.job.select("runAt").distinct().orderBy("runAt").toSQL().text).toBe(
      'SELECT extract(epoch from "subquery"."runAt") AS "runAt" FROM (SELECT DISTINCT "job"."run_at" AS "runAt" FROM "job" AS "job") AS "subquery" ORDER BY "subquery"."runAt"',
    )
    expect(
      schema.job
        .select("runAt", "id")
        .distinct()
        .orderBy(job => desc(job.runAt))
        .limit(3)
        .toSQL().text,
    ).toBe(
      'SELECT extract(epoch from "subquery"."runAt") AS "runAt", "subquery"."id" AS "id" FROM (SELECT DISTINCT "job"."run_at" AS "runAt", "job"."id" AS "id" FROM "job" AS "job" ORDER BY 1 DESC LIMIT $1) AS "subquery" ORDER BY "subquery"."runAt" DESC',
    )
  })

  it("read from a derived source a selected expression that is a sort key or a key of a group, which is evaluated once", () => {
    expect(
      schema.job
        .groupBy("queueId")
        .select(job => ({
          queueId: job.queueId,
          last: max(job.runAt),
        }))
        .orderBy((_job, selected) => desc(selected.last))
        .toSQL().text,
    ).toBe(
      'SELECT "subquery"."queueId" AS "queueId", extract(epoch from "subquery"."last") AS "last" FROM (SELECT "job"."queue_id" AS "queueId", max("job"."run_at") AS "last" FROM "job" AS "job" GROUP BY 1) AS "subquery" ORDER BY "subquery"."last" DESC',
    )
    expect(
      schema.job
        .select(job => ({
          at: coalesce(job.lockedAt, job.runAt),
          jobs: count(),
        }))
        .groupBy((_job, selected) => selected.at)
        .toSQL().text,
    ).toBe(
      'SELECT extract(epoch from "subquery"."at") AS "at", "subquery"."jobs" AS "jobs" FROM (SELECT coalesce("job"."locked_at", "job"."run_at") AS "at", count(*) AS "jobs" FROM "job" AS "job" GROUP BY 1) AS "subquery"',
    )
  })

  it("read from a derived source a selected expression that is only a key of distinctOn", () => {
    expect(
      schema.job
        .select(job => ({
          at: coalesce(job.lockedAt, job.runAt),
          id: job.id,
        }))
        .distinctOn((_job, selected) => selected.at)
        .toSQL().text,
    ).toBe(
      'SELECT extract(epoch from "subquery"."at") AS "at", "subquery"."id" AS "id" FROM (SELECT DISTINCT ON (1) coalesce("job"."locked_at", "job"."run_at") AS "at", "job"."id" AS "id" FROM "job" AS "job") AS "subquery"',
    )
  })

  it("keep PostgreSQL from merging the derived source of a sorted expression, which it would evaluate twice", () => {
    expect(
      schema.job
        .select(job => ({
          id: job.id,
          at: coalesce(job.lockedAt, job.runAt),
        }))
        .orderBy((_job, selected) => selected.at)
        .toSQL().text,
    ).toBe(
      'SELECT "subquery"."id" AS "id", extract(epoch from "subquery"."at") AS "at" FROM (SELECT "job"."id" AS "id", coalesce("job"."locked_at", "job"."run_at") AS "at" FROM "job" AS "job" OFFSET 0) AS "subquery" ORDER BY "subquery"."at"',
    )
  })

  it("keep a selected expression that no clause takes in the select list", () => {
    expect(
      schema.job
        .select(job => ({
          id: job.id,
          at: coalesce(job.lockedAt, job.runAt),
        }))
        .orderBy("id")
        .toSQL().text,
    ).toBe(
      'SELECT "job"."id" AS "id", extract(epoch from (coalesce("job"."locked_at", "job"."run_at"))) AS "at" FROM "job" AS "job" ORDER BY 1',
    )
  })
})

describePostgres("in PostgreSQL", ({ database, testTransaction, useTestFixture }) => {
  useTestFixture(() =>
    database.script(`
      CREATE TABLE queue (id integer PRIMARY KEY);
      CREATE TABLE job (
        id integer PRIMARY KEY,
        queue_id integer NOT NULL,
        priority integer NOT NULL,
        run_at timestamptz NOT NULL,
        locked_at timestamptz
      );
      INSERT INTO queue VALUES (1), (2);
      INSERT INTO job VALUES
        (1, 1, 30, '2026-01-15T07:00:00.123Z', NULL),
        (2, 1, 10, '2026-01-14T07:00:00Z', '2026-01-16T00:00:00Z'),
        (3, 2, 20, '2026-01-13T07:00:00Z', NULL),
        (4, 2, 10, '2026-01-14T07:00:00Z', NULL);
    `),
  )

  const db = bindSchema(schema, database)
  const jan13 = new Date("2026-01-13T07:00:00Z")
  const jan14 = new Date("2026-01-14T07:00:00Z")
  const jan16 = new Date("2026-01-16T00:00:00Z")

  /** Runs `callback` in a test transaction of `DateStyle = 'SQL, DMY'`, whose format of dates the built-in `timestamptz` does not decode, and of `TimeZone = 'Asia/Tokyo'`. */
  function withOtherDateStyle<T>(callback: () => Promise<T>): Promise<T> {
    return testTransaction(async () => {
      await database.script(`SET LOCAL DateStyle = 'SQL, DMY'; SET LOCAL TimeZone = 'Asia/Tokyo'`)
      return await callback()
    })
  }

  it("reads the values of a type by its read expression whatever the DateStyle of the session, which the built-in type does not decode", async () => {
    const { text, rows, value } = await withOtherDateStyle(async () => ({
      text: await db.$query`SELECT run_at FROM job WHERE id = 1`.get(t.text),
      rows: await db.job.select("id", "runAt", "lockedAt").orderBy("runAt", "id"),
      value: await db.job.max("lockedAt"),
    }))

    expect(text).toBe("15/01/2026 16:00:00.123 JST")
    expect(rows).toEqual([
      { id: 3, runAt: jan13, lockedAt: null },
      { id: 2, runAt: jan14, lockedAt: jan16 },
      { id: 4, runAt: jan14, lockedAt: null },
      { id: 1, runAt: date, lockedAt: null },
    ])
    expect(value).toEqual(jan16)
  })

  it("reads the values of packed nested rows and of RETURNING by the read expression", async () => {
    const { queues, inserted } = await withOtherDateStyle(async () => ({
      queues: await db.queue
        .select(queue => ({
          id: queue.id,
          last: queue.jobs.max("runAt"),
          jobs: queue.jobs.select("runAt", "lockedAt").orderBy("id"),
        }))
        .orderBy("id"),
      inserted: await db.job
        .insert({ id: 5, queueId: 2, priority: 1, runAt: date })
        .select("runAt", "lockedAt"),
    }))

    expect(queues).toEqual([
      {
        id: 1,
        last: date,
        jobs: [
          { runAt: date, lockedAt: null },
          { runAt: jan14, lockedAt: jan16 },
        ],
      },
      {
        id: 2,
        last: jan14,
        jobs: [
          { runAt: jan13, lockedAt: null },
          { runAt: jan14, lockedAt: null },
        ],
      },
    ])
    expect(inserted).toEqual({ runAt: date, lockedAt: null })
  })

  it("sorts, compares, groups, and aggregates the values themselves rather than what their read expression returns", async () => {
    const result = await testTransaction(async () => ({
      sorted: await db.job.pluck("priority").orderBy("priority", "id"),
      distinct: await db.job.pluck("priority").distinct().orderBy("priority"),
      page: await db.job.select("priority", "id").distinct().orderBy("priority", "id").limit(2),
      first: await db.job
        .distinctOn("priority")
        .select("priority", "id")
        .orderBy(job => [job.priority, desc(job.id)]),
      groups: await db.job
        .groupBy("queueId")
        .select(job => ({
          queueId: job.queueId,
          highest: max(job.priority),
        }))
        .orderBy((_job, selected) => selected.highest),
      keys: await db.job
        .select(job => ({
          priority: coalesce(job.priority, 0),
          jobs: count(),
        }))
        .groupBy((_job, selected) => selected.priority)
        .orderBy((_job, selected) => selected.priority),
      firstOfKey: await db.job
        .select(job => ({
          priority: coalesce(job.priority, 0),
          queueId: job.queueId,
        }))
        .distinctOn((_job, selected) => selected.priority)
        .orderBy((job, selected) => [selected.priority, job.id]),
      average: await db.job.avg("priority"),
    }))

    expect(result).toEqual({
      sorted: [10, 10, 20, 30],
      distinct: [10, 20, 30],
      page: [
        { priority: 10, id: 2 },
        { priority: 10, id: 4 },
      ],
      first: [
        { priority: 10, id: 4 },
        { priority: 20, id: 3 },
        { priority: 30, id: 1 },
      ],
      groups: [
        { queueId: 2, highest: 20 },
        { queueId: 1, highest: 30 },
      ],
      keys: [
        { priority: 10, jobs: 2 },
        { priority: 20, jobs: 1 },
        { priority: 30, jobs: 1 },
      ],
      firstOfKey: [
        { priority: 10, queueId: 1 },
        { priority: 20, queueId: 2 },
        { priority: 30, queueId: 1 },
      ],
      average: 17.5,
    })
  })
})
