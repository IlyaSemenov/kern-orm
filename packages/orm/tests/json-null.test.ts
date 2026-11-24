import { expect, test } from "bun:test"

import type { JsonNull } from "kern-orm"
import {
  bindSchema,
  caseWhen,
  coalesce,
  columnsOf,
  defineSchema,
  defineTable,
  jsonNull,
  many,
  param,
  sql,
} from "kern-orm"
import { jsonNull as dbJsonNull } from "kern-orm/db"
import * as dbTypes from "kern-orm/db/types"
import * as t from "kern-orm/types"

import { describePostgres } from "../testing/postgres"

type Payload = { url?: string | null }

const queue = defineTable("queue", {
  id: t.integer.primaryKey(),
})
// The type of "JSON null values" of the Types page of the ORM group.
const payloadType = t.jsonbWithJsonNull.of<Payload | JsonNull>()
const job = defineTable("job", {
  id: t.integer.primaryKey(),
  queueId: t.integer.nullable().columnName("queue_id"),
  payload: payloadType.nullable(),
  source: t.jsonWithJsonNull.of<Payload | JsonNull>().nullable(),
  history: t.array(payloadType.nullable()).default([]),
})
const schema = defineSchema({ queue, job }).$relations({
  queue: {
    jobs: many(job, { from: "id", to: "queueId" }),
  },
})

test("shares jsonNull across kern-orm, kern-orm/types, kern-orm/db, and kern-orm/db/types", () => {
  expect([t.jsonNull, dbJsonNull, dbTypes.jsonNull]).toEqual([jsonNull, jsonNull, jsonNull])
})

describePostgres(
  "JSON columns that read and write a JSON null value as jsonNull",
  ({ database, testTransaction, useTestFixture }) => {
    const db = bindSchema(schema, database)

    useTestFixture(() =>
      database.script(`
      CREATE TABLE queue (id integer PRIMARY KEY);
      CREATE TABLE job (
        id integer PRIMARY KEY,
        queue_id integer,
        payload jsonb DEFAULT '{"url": "/default"}',
        source json,
        history jsonb[] NOT NULL
      );
      INSERT INTO queue VALUES (1), (2);
      INSERT INTO job VALUES
        (1, 1, 'null', ' null ', '{}'),
        (2, 1, NULL, NULL, '{}'),
        (3, 1, '{"url": null}', '{"url": null}', ARRAY['null'::jsonb, NULL, '{"url": null}']);
    `),
    )

    test("reads a JSON null value as jsonNull and NULL as null, in records, values, and nested records", () =>
      testTransaction(async () => {
        expect(await db.job.orderBy("id").select("id", "payload", "source")).toStrictEqual([
          { id: 1, payload: jsonNull, source: jsonNull },
          { id: 2, payload: null, source: null },
          { id: 3, payload: { url: null }, source: { url: null } },
        ])
        expect(await db.job.orderBy("id").pluck("payload")).toStrictEqual([
          jsonNull,
          null,
          { url: null },
        ])
        expect(await db.job.find(1).get("payload")).toBe(jsonNull)
        expect(await db.job.find(2).get("payload")).toBeNull()
        expect(await db.job.find(3).get("history")).toStrictEqual([jsonNull, null, { url: null }])
        expect(
          await db.queue.find(1).select(queue => ({
            jobs: queue.jobs.orderBy("id").select("payload", "source", "history"),
            payloads: queue.jobs.orderBy("id").pluck("payload"),
          })),
        ).toStrictEqual({
          jobs: [
            { payload: jsonNull, source: jsonNull, history: [] },
            { payload: null, source: null, history: [] },
            {
              payload: { url: null },
              source: { url: null },
              history: [jsonNull, null, { url: null }],
            },
          ],
          payloads: [jsonNull, null, { url: null }],
        })
      }))

    test("takes jsonNull as a JSON null value and null as NULL in an insert and an update, and undefined as no value", () =>
      testTransaction(async () => {
        await db.job.insertMany([
          { id: 4, payload: jsonNull, source: jsonNull, history: [jsonNull, null] },
          { id: 5, payload: null },
          { id: 6 },
          { id: 7, payload: undefined },
        ])
        await db.job.find(3).update({ payload: jsonNull, source: null })
        await db.job.find(1).update({ payload: null })
        // An update keeps a column given as undefined.
        await db.job.find(4).update({ payload: undefined })

        expect(await db.job.orderBy("id").select("id", "payload", "source")).toStrictEqual([
          { id: 1, payload: null, source: jsonNull },
          { id: 2, payload: null, source: null },
          { id: 3, payload: jsonNull, source: null },
          { id: 4, payload: jsonNull, source: jsonNull },
          { id: 5, payload: null, source: null },
          { id: 6, payload: { url: "/default" }, source: null },
          { id: 7, payload: { url: "/default" }, source: null },
        ])
        expect(await db.job.find(4).get("history")).toStrictEqual([jsonNull, null])
        expect(
          await database.query`
            SELECT id FROM job WHERE jsonb_typeof(payload) = 'null' ORDER BY id
          `.pluck(t.integer),
        ).toEqual([3, 4])
      }))

    test("matches a JSON null value by jsonNull and NULL by null, in object conditions and operators", () =>
      testTransaction(async () => {
        expect(await db.job.where({ payload: jsonNull }).pluck("id")).toEqual([1])
        expect(await db.job.where({ payload: null }).pluck("id")).toEqual([2])
        expect(await db.job.where(job => job.payload.eq(jsonNull)).pluck("id")).toEqual([1])
        expect(await db.job.where(job => job.payload.ne(jsonNull)).pluck("id")).toEqual([3])
        expect(
          await db.job
            .where(job => job.payload.in([jsonNull, { url: null }]))
            .orderBy("id")
            .pluck("id"),
        ).toEqual([1, 3])
        expect(await db.job.where(job => job.payload.isNull()).pluck("id")).toEqual([2])
        expect(await db.job.where(job => job.source.isNull()).pluck("id")).toEqual([2])
        // PostgreSQL has no `=` for `json`: the recipe of "JSON null values" of the Types page of the ORM group.
        expect(
          await db.job.where(job => sql`json_typeof(${job.source}) = 'null'`).pluck("id"),
        ).toEqual([1])
      }))

    test("takes jsonNull as a fallback of coalesce and as a value of caseWhen, and keeps a JSON null value, which is not NULL", () =>
      testTransaction(async () => {
        expect(
          await db.job.orderBy("id").select(job => ({
            fallback: coalesce(job.payload, jsonNull),
            kept: coalesce(job.payload, {}),
            isJsonNull: job.payload.eq(jsonNull),
            marked: caseWhen(payloadType, [[job.payload.isNull(), jsonNull]], null),
            constant: param(payloadType, jsonNull),
          })),
        ).toStrictEqual([
          {
            fallback: jsonNull,
            kept: jsonNull,
            isJsonNull: true,
            marked: null,
            constant: jsonNull,
          },
          { fallback: jsonNull, kept: {}, isJsonNull: null, marked: jsonNull, constant: jsonNull },
          {
            fallback: { url: null },
            kept: { url: null },
            isJsonNull: false,
            marked: null,
            constant: jsonNull,
          },
        ])
        expect(await db.job.find(2).get("payload").coalesce(jsonNull)).toBe(jsonNull)
        expect(await db.job.find(1).get("payload").coalesce({})).toBe(jsonNull)
      }))

    test("reads the columns of a statement of SQL text, also of an outer-joined record, which is null without its row", () =>
      testTransaction(async () => {
        const jobColumns = columnsOf(db.job, "*", { alias: "j" })

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
          {
            id: 1,
            job: { id: 1, queueId: 1, payload: jsonNull, source: jsonNull, history: [] },
          },
          { id: 1, job: { id: 2, queueId: 1, payload: null, source: null, history: [] } },
          { id: 2, job: null },
        ])
      }))
  },
)
