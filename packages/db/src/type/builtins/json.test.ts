import { expect, it } from "bun:test"

import { getThrownError } from "@kern-orm/test-harness/errors"
import { describePostgres } from "@kern-orm/test-harness/postgres"

import { createSqlColumns } from "../../sql/columns"
import { param } from "../../sql/fragment"

import { array } from "./array"
import { boolean } from "./boolean"
import type { JsonNull } from "./json"
import { json, jsonb, jsonbWithJsonNull, jsonNull, jsonWithJsonNull } from "./json"
import { integer } from "./numeric"

it("has one marker of a JSON null value in every copy of the package", () => {
  // An application may take the marker from a copy of kern-db other than the one of its types.
  expect(jsonNull).toBe(Symbol.for("kern-db.jsonNull") as typeof jsonNull)
})

it("converts a top-level JSON null value to and from the marker", () => {
  for (const type of [jsonWithJsonNull, jsonbWithJsonNull]) {
    expect(type.encode(jsonNull)).toBe("null")
    expect(type.decode("null")).toBe(jsonNull)
    // `json` keeps the text as it was written.
    expect(type.decode(" null\n")).toBe(jsonNull)
    expect(type.encode({ url: null, tags: [null] })).toBe('{"url":null,"tags":[null]}')
    expect(type.decode('{"url":null,"tags":[null]}')).toStrictEqual({ url: null, tags: [null] })
    expect(type.decode("[null]")).toStrictEqual([null])
    // The marker inside a value is not a JSON value: JSON leaves it out of an object and writes it as null in an array.
    expect(type.encode({ url: jsonNull })).toBe("{}")
    expect(type.encode([jsonNull])).toBe("[null]")
    // The string is not a JSON null value.
    expect(type.encode("null")).toBe('"null"')
    expect(type.decode('"null"')).toBe("null")
    expect(type.encode(0)).toBe("0")
    expect(type.encode(false)).toBe("false")
  }
})

it("rejects a value other than the marker that JSON writes as a top-level null", () => {
  const error = new TypeError(
    "Value serializes to a top-level JSON null; to store a JSON null value intentionally, pass jsonNull and include JsonNull in any declared shape",
  )
  for (const value of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    new Date(Number.NaN),
    { toJSON: () => null },
  ]) {
    expect(getThrownError(() => jsonbWithJsonNull.encode(value))).toEqual(error)
  }
  expect(getThrownError(() => jsonWithJsonNull.encode(Number.NaN))).toEqual(error)
  // `json` and `jsonb` keep writing such a value as a JSON null value.
  expect(json.encode(Number.NaN)).toBe("null")
  expect(jsonb.encode(Number.NaN)).toBe("null")
  expect(getThrownError(() => jsonbWithJsonNull.encode(() => 1))).toEqual(
    new TypeError("Cannot encode function as JSON"),
  )
})

it("rejects the marker as a value of json and jsonb", () => {
  const error = new TypeError(
    "Cannot encode jsonNull with this type; use jsonWithJsonNull or jsonbWithJsonNull to write a JSON null value",
  )
  expect(getThrownError(() => json.encode(jsonNull))).toEqual(error)
  expect(getThrownError(() => jsonb.encode(jsonNull))).toEqual(error)
  expect(getThrownError(() => jsonb.encode(Symbol("other")))).toEqual(
    new TypeError("Cannot encode symbol as JSON"),
  )
})

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

  it("tells a JSON null value from NULL through the types that read and write it as the marker", () =>
    testTransaction(async () => {
      type Payload = { url?: string | null }
      // The types of "JSON null values" of the Types page of the Database group.
      const payloadType = jsonbWithJsonNull.of<Payload | JsonNull>()
      const textPayloadType = jsonWithJsonNull.of<Payload | JsonNull>()
      await database.script`CREATE TABLE job (id integer, payload jsonb, source json)`
      await database.query`
        INSERT INTO job (id, payload, source) VALUES
          (1, ${param(payloadType, jsonNull)}, ${param(textPayloadType, jsonNull)}),
          (2, ${param(payloadType.nullable(), null)}, ${param(textPayloadType.nullable(), null)}),
          (3, ${param(payloadType, { url: "/a" })}, ${param(textPayloadType, { url: "/a" })}),
          (4, '{"url": null}', ' null ')
      `

      expect(
        await database.query`SELECT payload FROM job ORDER BY id`.pluck(payloadType.nullable()),
      ).toStrictEqual([jsonNull, null, { url: "/a" }, { url: null }])
      expect(
        await database.query`SELECT source FROM job ORDER BY id`.pluck(textPayloadType.nullable()),
      ).toStrictEqual([jsonNull, null, { url: "/a" }, jsonNull])
      expect(
        await database.query`SELECT payload IS NULL FROM job ORDER BY id`.pluck(boolean),
      ).toEqual([false, true, false, false])
      expect(
        await database.query`
          SELECT id FROM job WHERE payload = ${param(payloadType, jsonNull)} ORDER BY id
        `.pluck(integer),
      ).toEqual([1])
    }))

  it("tells a JSON null value from a NULL element in an array", () =>
    testTransaction(async () => {
      const payloadsType = array(jsonbWithJsonNull.nullable())

      expect(
        await database.query`
          SELECT ${param(payloadsType, [jsonNull, null, { url: null }, "null"])} AS payloads
        `.pluck(payloadsType),
      ).toStrictEqual([[jsonNull, null, { url: null }, "null"]])
      expect(
        await database.query`SELECT ARRAY['null'::jsonb, NULL, '"NULL"'::jsonb]`.pluck(
          payloadsType,
        ),
      ).toStrictEqual([[jsonNull, null, "NULL"]])
    }))
})
