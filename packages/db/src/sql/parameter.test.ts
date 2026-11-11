import { describe, expect, it } from "bun:test"

import { getThrownError } from "@kern-orm/test-harness/errors"
import { describePostgres } from "@kern-orm/test-harness/postgres"

import type { TextValue } from "../driver"
import { boolean } from "../type/builtins/boolean"
import { bytea } from "../type/builtins/bytea"
import { timestamptz } from "../type/builtins/datetime"
import { bigint, doublePrecision } from "../type/builtins/numeric"
import { text } from "../type/builtins/text"

import { assertUntypedValue, bindParameter, encodeParameter, maxParameters } from "./parameter"

describe("encodeParameter", () => {
  it("encodes a value without a type by its JavaScript type", () => {
    expect([
      encodeParameter("it's", undefined),
      encodeParameter(1.5, undefined),
      encodeParameter(2n ** 64n, undefined),
      encodeParameter(true, undefined),
      encodeParameter(false, undefined),
      encodeParameter(null, undefined),
      encodeParameter(new Date("2026-01-02T03:04:05.678Z"), undefined),
      encodeParameter(new Uint8Array([0, 255]), undefined),
    ]).toEqual([
      "it's",
      "1.5",
      "18446744073709551616",
      "t",
      "f",
      null,
      "2026-01-02T03:04:05.678Z",
      "\\x00ff",
    ])
  })

  it("rejects a value that a parameter does not take without a type, naming param", () => {
    const takes =
      "A parameter without a type takes a string, a number, a bigint, a boolean, null, a Date, or a Uint8Array"
    for (const [value, kind] of [
      [{ name: "Survey" }, "an object"],
      [new Map(), "an object"],
      [[1, 2], "an array"],
      [() => 1, "a function"],
      [Symbol("value"), "a symbol"],
    ] as const) {
      const error = new TypeError(`${takes}, not ${kind}; pass JSON or an array with param()`)
      expect(getThrownError(() => assertUntypedValue(value))).toEqual(error)
      expect(getThrownError(() => encodeParameter(value, undefined))).toEqual(error)
    }
  })

  it("rejects undefined, with a type and without one", () => {
    const type = { encode: () => "encoded" } as never

    const error = new TypeError("Query parameter is undefined; use null for NULL")
    expect(getThrownError(() => assertUntypedValue(undefined))).toEqual(error)
    expect(getThrownError(() => encodeParameter(undefined, undefined))).toEqual(error)
    expect(() => encodeParameter(undefined, type)).toThrow("Query parameter is undefined")
  })
})

describePostgres("values without a type in PostgreSQL", ({ database, testTransaction }) => {
  it("are read by PostgreSQL as the values of the types of their places, in any time zone of the session", () =>
    testTransaction(async () => {
      await database.query`SET LOCAL TimeZone = 'Asia/Kathmandu'`
      const values = await database.query`
        SELECT
          ${`it's "quoted"`}::text AS text,
          ${1.5}::double precision AS number,
          ${9007199254740993n}::bigint AS bigint,
          ${false}::boolean AS boolean,
          ${null}::text AS nothing,
          ${new Date("2026-01-15T07:00:00.123Z")}::timestamptz AS date,
          ${new Uint8Array([0, 255])}::bytea AS bytes
      `
        .select({
          text: text,
          number: doublePrecision,
          bigint: bigint,
          boolean: boolean,
          nothing: text.nullable(),
          date: timestamptz,
          bytes: bytea,
        })
        .take()

      expect(values).toEqual({
        text: `it's "quoted"`,
        number: 1.5,
        bigint: 9007199254740993n,
        boolean: false,
        nothing: null,
        date: "2026-01-15T07:00:00.123000Z",
        bytes: new Uint8Array([0, 255]),
      })
    }))
})

describe("bindParameter", () => {
  it("numbers parameters and rejects more than PostgreSQL takes", () => {
    const parameters: TextValue[] = []

    expect([bindParameter(parameters, "1"), bindParameter(parameters, null)]).toEqual(["$1", "$2"])
    for (let index = 2; index < maxParameters; index++) {
      bindParameter(parameters, "1")
    }
    expect(() => bindParameter(parameters, "1")).toThrow(
      "Statement has more than 65535 parameters, which PostgreSQL does not take; split it into several statements, such as in a transaction",
    )
    expect(parameters).toHaveLength(maxParameters)
  })
})
