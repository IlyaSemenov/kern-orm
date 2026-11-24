import { expect, it } from "bun:test"

import { getThrownError } from "@kern-orm/test-harness/errors"
import { describePostgres } from "@kern-orm/test-harness/postgres"

import { createSqlColumns } from "../../sql/columns"
import { param } from "../../sql/fragment"

import { boolean } from "./boolean"
import { jsonb } from "./json"
import { integer } from "./numeric"

describePostgres("in PostgreSQL", ({ database, testTransaction }) => {
  // The type of "JSON null values" of the Types page of the Database group.
  const payloadType = jsonb.nullableAs(() => undefined)

  it("tells NULL from a JSON null value through a type that decodes NULL to undefined", () =>
    testTransaction(async () => {
      await database.script`CREATE TABLE job (id integer, payload jsonb)`
      await database.query`
        INSERT INTO job (id, payload) VALUES
          (1, 'null'::jsonb),
          (2, ${param(payloadType, null)}),
          (3, ${param(payloadType, { url: "/a" })}),
          (4, ${JSON.stringify(null)}::jsonb)
      `

      expect(
        await database.query`SELECT payload FROM job ORDER BY id`.pluck(payloadType),
      ).toStrictEqual([null, undefined, { url: "/a" }, null])
      expect(
        await database.query`SELECT id, payload FROM job WHERE id < 4 ORDER BY id`.select({
          id: integer,
          payload: payloadType,
        }),
      ).toStrictEqual([
        { id: 1, payload: null },
        { id: 2, payload: undefined },
        { id: 3, payload: { url: "/a" } },
      ])
      expect(
        await database.query`SELECT payload IS NULL FROM job ORDER BY id`.pluck(boolean),
      ).toEqual([false, true, false, false])
      // A parameter takes no undefined, also of a type that returns it for NULL.
      expect(getThrownError(() => param(payloadType, undefined as never))).toEqual(
        new TypeError("Query parameter is undefined; use null for NULL"),
      )
    }))

  it("reads NULL of a column of an outer-joined record as undefined, and the record without its row as null", () =>
    testTransaction(async () => {
      await database.script`
        CREATE TABLE job (id integer PRIMARY KEY, payload jsonb);
        CREATE TABLE run (id integer, job_id integer);
        INSERT INTO job (id, payload) VALUES (1, NULL), (2, 'null'::jsonb);
        INSERT INTO run (id, job_id) VALUES (1, 1), (2, 2), (3, NULL);
      `
      const job = createSqlColumns(
        [
          { key: "id", name: "id", type: integer },
          { key: "payload", name: "payload", type: payloadType },
        ],
        { alias: "j", key: ["id"] },
      )

      expect(
        await database.query`
          SELECT r.id, ${job} FROM run r LEFT JOIN job j ON j.id = r.job_id ORDER BY r.id
        `.select({
          id: integer,
          job: job.nullable(),
        }),
      ).toStrictEqual([
        { id: 1, job: { id: 1, payload: undefined } },
        { id: 2, job: { id: 2, payload: null } },
        { id: 3, job: null },
      ])
    }))

  it("tells a JSON null value from NULL through a type that gives the JSON null value a value of its own", () =>
    testTransaction(async () => {
      const jsonNull = Symbol("JSON null")
      type Payload = { url?: string }
      // The type of a symbol of "JSON null values" of the Types page of the Database group.
      const payloadType = jsonb.of<Payload>().transform({
        decode: (value): Payload | typeof jsonNull => (value === null ? jsonNull : value),
        encode: (value: Payload | typeof jsonNull) =>
          value === jsonNull ? (null as never) : value,
      })
      await database.script`CREATE TABLE job (id integer, payload jsonb)`
      await database.query`
        INSERT INTO job (id, payload) VALUES
          (1, ${param(payloadType, jsonNull)}),
          (2, ${param(payloadType.nullable(), null)}),
          (3, ${param(payloadType, { url: "/a" })})
      `

      const payloads = await database.query`SELECT payload FROM job ORDER BY id`.pluck(
        payloadType.nullable(),
      )
      expect(payloads).toEqual([jsonNull, null, { url: "/a" }])
      expect(
        await database.query`SELECT payload IS NULL FROM job ORDER BY id`.pluck(boolean),
      ).toEqual([false, true, false])
    }))
})
