import { expect, test } from "bun:test"

import { getThrownError } from "@kern-orm/test-harness/errors"
import {
  bindSchema,
  coalesce,
  columnsOf,
  defineSchema,
  defineTable,
  many,
  param,
  ResultDecodeError,
  sql,
} from "kern-orm"
import * as t from "kern-orm/types"

import { describePostgres } from "../testing/postgres"

const queue = defineTable("queue", {
  id: t.integer.primaryKey(),
})
// The type of "JSON null values" of the Types page of the ORM group.
const payloadType = t.jsonb.nullableAs(() => undefined)
const job = defineTable("job", {
  id: t.integer.primaryKey(),
  queueId: t.integer.nullable().columnName("queue_id"),
  payload: payloadType,
})
const schema = defineSchema({ queue, job }).$relations({
  queue: {
    jobs: many(job, { from: "id", to: "queueId" }),
  },
})

describePostgres(
  "a jsonb column that decodes NULL to undefined",
  ({ database, testTransaction, useTestFixture }) => {
    const db = bindSchema(schema, database)

    useTestFixture(() =>
      database.script(`
      CREATE TABLE queue (id integer PRIMARY KEY);
      CREATE TABLE job (
        id integer PRIMARY KEY,
        queue_id integer,
        payload jsonb DEFAULT '{"url": "/default"}'
      );
      INSERT INTO queue VALUES (1), (2);
      INSERT INTO job VALUES
        (1, 1, 'null'),
        (2, 1, NULL),
        (3, 1, '{"url": "/a"}');
    `),
    )

    test("reads NULL as undefined and a JSON null value as null, in records, values, and nested records", () =>
      testTransaction(async () => {
        expect(await db.job.orderBy("id").select("id", "payload")).toStrictEqual([
          { id: 1, payload: null },
          { id: 2, payload: undefined },
          { id: 3, payload: { url: "/a" } },
        ])
        expect(await db.job.find(2).select("*")).toStrictEqual({
          id: 2,
          queueId: 1,
          payload: undefined,
        })
        expect(await db.job.orderBy("id").pluck("payload")).toStrictEqual([
          null,
          undefined,
          { url: "/a" },
        ])
        expect(await db.job.find(1).get("payload")).toBeNull()
        expect(await db.job.find(2).get("payload")).toBeUndefined()
        expect(
          await db.queue.find(1).select(queue => ({
            jobs: queue.jobs.orderBy("id").select("payload"),
            payloads: queue.jobs.orderBy("id").pluck("payload"),
          })),
        ).toStrictEqual({
          jobs: [{ payload: null }, { payload: undefined }, { payload: { url: "/a" } }],
          payloads: [null, undefined, { url: "/a" }],
        })
      }))

    test("gives a missing row of get and a row whose value is NULL the same undefined, and a record of the row apart from them", () =>
      testTransaction(async () => {
        expect(await db.job.find(2).get("payload").optional()).toBeUndefined()
        expect(await db.job.find(9).get("payload").optional()).toBeUndefined()
        expect(await db.job.find(2).select("payload").optional()).toStrictEqual({
          payload: undefined,
        })
        expect(await db.job.find(9).select("payload").optional()).toBeUndefined()
      }))

    test("reads NULL of an expression of the type as undefined, and of an expression of another type as null", () =>
      testTransaction(async () => {
        expect(
          await db.job.find(2).select(job => ({
            missing: param(payloadType, null),
            isEmpty: job.payload.eq({}),
            fallback: coalesce(job.payload, {}),
          })),
        ).toStrictEqual({ missing: undefined, isEmpty: null, fallback: {} })
      }))

    test("rejects NULL of a type whose function of NULL returns a Promise, in a value of get, a field of a record, and a field of a nested record", () =>
      testTransaction(async () => {
        // @ts-expect-error The function returns its value synchronously.
        const pendingType = t.jsonb.nullableAs(async () => undefined)
        const pending = param(pendingType, null)
        const message =
          "The function of nullableAs() must return the value of NULL synchronously, not a Promise or a query"

        for (const query of [
          db.job.find(2).get(() => pending),
          db.job.find(2).select(() => ({
            payload: pending,
          })),
          db.queue.find(1).select(queue => ({
            jobs: queue.jobs.select(() => ({
              payload: pending,
            })),
          })),
        ]) {
          const error = await query.then(
            () => undefined,
            (error: unknown) => error,
          )
          expect(error).toBeInstanceOf(ResultDecodeError)
          expect((error as ResultDecodeError).cause).toEqual(new TypeError(message))
        }
      }))

    test("takes null as NULL in an insert, an update, and a condition, a JSON null value as SQL, and undefined as no value", () =>
      testTransaction(async () => {
        const jsonNull = sql(t.jsonb)`'null'::jsonb`
        await db.job.insertMany([
          { id: 4, payload: null },
          { id: 5 },
          { id: 6, payload: jsonNull },
          { id: 7, payload: undefined },
        ])
        await db.job.find(3).update({ payload: null })
        // An update keeps a column given as undefined, also of a type that returns it for NULL.
        await db.job.find(6).update({ payload: undefined })

        expect(await db.job.where({ payload: null }).orderBy("id").pluck("id")).toEqual([2, 3, 4])
        expect(
          await db.job
            .where(job => job.payload.isNull())
            .orderBy("id")
            .pluck("id"),
        ).toEqual([2, 3, 4])
        expect(await db.job.where({ payload: jsonNull }).orderBy("id").pluck("id")).toEqual([1, 6])
        // An insert that omits the column, or gives it as undefined, leaves it its default rather than NULL.
        expect(
          await db.job
            .where(job => job.id.in([5, 7]))
            .orderBy("id")
            .pluck("payload"),
        ).toStrictEqual([{ url: "/default" }, { url: "/default" }])
      }))

    test("takes no undefined as a parameter", () => {
      const error = new TypeError("Query parameter is undefined; use null for NULL")
      // @ts-expect-error A compared value is not undefined.
      const compare = () => db.job.where(job => job.payload.eq(undefined)).toSQL()

      expect(getThrownError(compare)).toEqual(error)
      expect(
        getThrownError(() =>
          db.job
            .select(() => ({
              payload: param(payloadType, undefined as never),
            }))
            .toSQL(),
        ),
      ).toEqual(error)
    })

    test("reads the columns of a statement of SQL text, also of an outer-joined record, which is null without its row", () =>
      testTransaction(async () => {
        const jobColumns = columnsOf(db.job, { alias: "j" })

        expect(
          await db.$query`SELECT ${jobColumns} FROM ${db.job} j ORDER BY j.id`.select({
            job: jobColumns,
          }),
        ).toStrictEqual([
          { job: { id: 1, queueId: 1, payload: null } },
          { job: { id: 2, queueId: 1, payload: undefined } },
          { job: { id: 3, queueId: 1, payload: { url: "/a" } } },
        ])
        expect(
          await db.$query`
          SELECT q.id, ${jobColumns}
          FROM ${db.queue} q LEFT JOIN ${db.job} j ON j.queue_id = q.id AND j.id <> 3
          ORDER BY q.id, j.id
        `.select({
            id: t.integer,
            job: jobColumns.nullable(),
          }),
        ).toStrictEqual([
          { id: 1, job: { id: 1, queueId: 1, payload: null } },
          { id: 1, job: { id: 2, queueId: 1, payload: undefined } },
          { id: 2, job: null },
        ])
        // A column that can be NULL does not tell a missing row, whatever its type decodes NULL to, which the unknown values of a JSON column do not tell in types.
        expect(() => jobColumns.nullable({ by: ["payload"] })).toThrow(
          'Column "payload" is nullable, so its NULL does not tell a missing row of the record',
        )
      }))
  },
)
