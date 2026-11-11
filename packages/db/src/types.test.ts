import { expect, it } from "bun:test"
import { fileURLToPath } from "node:url"

import { describePostgres } from "@kern-orm/test-harness/postgres"
import { build } from "esbuild"

import type { SqlFragment } from "./sql/fragment"
import { param, sql } from "./sql/fragment"
import type { AnyType } from "./type/type"
import * as t from "./types"

it("loads only the modules of types", async () => {
  const sources = fileURLToPath(new URL(".", import.meta.url))
  const { metafile } = await build({
    entryPoints: ["./types.ts"],
    absWorkingDir: sources,
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
  })

  const modules = Object.keys(metafile.inputs).filter(path => path !== "types.ts")
  // No other module of kern-db, such as the transaction coordinator.
  expect(modules.filter(path => !path.startsWith("type/"))).toEqual([])
  expect(modules).toContain("type/builtins/datetime.ts")
})

describePostgres("built-in types in PostgreSQL", ({ database, testTransaction }) => {
  it("return the values that they encode into columns of their types, in any time zone of the session", () =>
    testTransaction(async () => {
      // A time zone of an offset in minutes, which one of whole hours would not check.
      await database.query`SET LOCAL TimeZone = 'Asia/Kathmandu'`
      await database.script`
        CREATE TABLE sample (
          smallint smallint, integer integer, real real, double double precision, bigint bigint, numeric numeric,
          text text, varchar varchar(10), char char(3), boolean boolean, uuid uuid, bytea bytea,
          timestamptz timestamptz, timestamp timestamp, date date, time time, interval interval,
          json json, jsonb jsonb, inet inet, cidr cidr,
          texts text[], timestamps timestamptz[], dates date[], bytes bytea[]
        )
      `
      // Columns of `sample` by their keys, with the values that their types decode.
      const columns: Record<string, [AnyType, unknown]> = {
        smallint: [t.smallint, -32768],
        integer: [t.integer, 2147483647],
        real: [t.real, 1.5],
        double: [t.doublePrecision, 0.1],
        bigint: [t.bigint, 9007199254740993n],
        numeric: [t.numeric, "1.000000000000000000000001"],
        text: [t.text, `it's "quoted"`],
        varchar: [t.varchar.with(10), "Survey"],
        char: [t.char.with(3), "a  "],
        boolean: [t.boolean, false],
        uuid: [t.uuid, "6f1e1c55-1f4a-4a51-9a63-2c1d6f0e7b10"],
        bytea: [t.bytea, new Uint8Array([0, 255])],
        timestamptz: [t.timestamptz, "2026-01-15T07:00:00.123456Z"],
        timestamp: [t.timestamp, "2026-01-15T10:00:00.000000"],
        date: [t.date, "2026-01-15"],
        time: [t.time, "10:00:00.000000"],
        interval: [t.interval, "1 day 02:00:00"],
        json: [t.json, { b: 1, a: [true, null] }],
        jsonb: [t.jsonb, { choices: ["a"] }],
        inet: [t.inet, "192.168.0.1"],
        cidr: [t.cidr, "10.0.0.0/8"],
        texts: [t.array(t.text.nullable()), ["a b", null, "", "c,d", `"q"`, "NULL", "\\"]],
        timestamps: [t.array(t.timestamptz), ["+010000-01-01T00:00:00.000000Z"]],
        dates: [t.array(t.date), ["0000-01-01", "-000001-12-31"]],
        bytes: [t.array(t.bytea), [new Uint8Array([0, 255]), new Uint8Array()]],
      }
      const types: Record<string, AnyType> = {}
      const values: Record<string, unknown> = {}
      let parameters: SqlFragment | undefined
      for (const [key, [type, value]] of Object.entries(columns)) {
        types[key] = type
        values[key] = value
        parameters =
          parameters === undefined ? param(type, value) : sql`${parameters}, ${param(type, value)}`
      }
      await database.query`INSERT INTO sample VALUES (${parameters!})`

      expect(await database.query`SELECT * FROM sample`.select(types).take()).toEqual(values)
    }))

  it("encode the other values that they accept", () =>
    testTransaction(async () => {
      const values = await database.query`
        SELECT
          ${param(t.bigint, 5)} AS bigint,
          ${param(t.numeric, 12.5)} AS "numericOfNumber",
          ${param(t.numeric, 5n)} AS "numericOfBigint",
          ${param(t.timestamptz, new Date("2026-01-15T07:00:00.123Z"))} AS timestamptz
      `
        .select({
          bigint: t.bigint,
          numericOfNumber: t.numeric,
          numericOfBigint: t.numeric,
          timestamptz: t.timestamptz,
        })
        .take()

      expect(values).toEqual({
        bigint: 5n,
        numericOfNumber: "12.5",
        numericOfBigint: "5",
        timestamptz: "2026-01-15T07:00:00.123000Z",
      })
    }))

  it("encode and decode the values of an existing enum", () =>
    testTransaction(async () => {
      await database.script`CREATE TYPE mood AS ENUM ('happy', 'sad')`
      const mood = t.enum("mood", ["happy", "sad"])

      expect(await database.query`SELECT ${param(mood, "sad")}`.get(mood)).toBe("sad")
      expect(
        await database.query`SELECT ${param(t.array(mood), ["happy", "sad"])}`.get(t.array(mood)),
      ).toEqual(["happy", "sad"])
    }))
})
