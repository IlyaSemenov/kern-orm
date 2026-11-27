import { describe, expect, it } from "bun:test"

import { describePostgres } from "@kern-orm/test-harness/postgres"

import { param, unsafeSql } from "../../sql/fragment"

import { boolean } from "./boolean"
import {
  normalizeDate,
  normalizeTime,
  normalizeTimestamp,
  normalizeTimestamptz,
  normalizeUtcJsonTimestamp,
  time,
  timestamp,
  timestamptz,
  timestamptzPortable,
  toPostgresYear,
} from "./datetime"

describe("normalizeTimestamptz", () => {
  it("formats UTC output with whole and fractional seconds", () => {
    expect(normalizeTimestamptz("2026-01-15 10:00:00+00")).toBe("2026-01-15T10:00:00.000000Z")
    expect(normalizeTimestamptz("2026-01-15 10:00:00.123456+00")).toBe(
      "2026-01-15T10:00:00.123456Z",
    )
  })

  it("converts the session time zone to UTC and keeps microseconds", () => {
    expect(normalizeTimestamptz("2026-01-15 14:00:00.123456+07")).toBe(
      "2026-01-15T07:00:00.123456Z",
    )
    expect(normalizeTimestamptz("2026-01-15 00:10:00-03:30")).toBe("2026-01-15T03:40:00.000000Z")
    expect(normalizeTimestamptz("2024-02-28 23:45:00-00:30")).toBe("2024-02-29T00:15:00.000000Z")
    expect(normalizeTimestamptz("2026-01-01 02:00:00.5+03")).toBe("2025-12-31T23:00:00.500000Z")
  })

  it("writes years outside 1 to 9999 as astronomical ISO 8601 years", () => {
    expect(normalizeTimestamptz("0001-01-01 06:42:04+06:42:04 BC")).toBe(
      "0000-01-01T00:00:00.000000Z",
    )
    expect(normalizeTimestamptz("0002-03-01 01:00:00+02 BC")).toBe("-000001-02-28T23:00:00.000000Z")
    expect(normalizeTimestamptz("10000-01-01 00:00:00+07")).toBe("9999-12-31T17:00:00.000000Z")
    expect(normalizeTimestamptz("294276-12-31 23:59:59+00")).toBe("+294276-12-31T23:59:59.000000Z")
  })

  it("keeps infinite values", () => {
    expect(normalizeTimestamptz("-infinity")).toBe("-infinity")
  })

  it("rejects values of another DateStyle", () => {
    expect(() => normalizeTimestamptz("01/15/2026 14:00:00 +07")).toThrow("DateStyle ISO")
  })
})

describe("normalizeUtcJsonTimestamp", () => {
  it("formats the JSON text of a UTC timestamp with whole and fractional seconds", () => {
    expect(normalizeUtcJsonTimestamp("2026-01-15T07:00:00")).toBe("2026-01-15T07:00:00.000000Z")
    expect(normalizeUtcJsonTimestamp("2026-01-15T07:00:00.1234")).toBe(
      "2026-01-15T07:00:00.123400Z",
    )
  })

  it("writes years outside 1 to 9999 as astronomical ISO 8601 years", () => {
    expect(normalizeUtcJsonTimestamp("0001-06-01T12:00:00.5 BC")).toBe(
      "0000-06-01T12:00:00.500000Z",
    )
    expect(normalizeUtcJsonTimestamp("0044-03-15T12:00:00 BC")).toBe(
      "-000043-03-15T12:00:00.000000Z",
    )
    expect(normalizeUtcJsonTimestamp("294276-12-31T23:59:59.999999")).toBe(
      "+294276-12-31T23:59:59.999999Z",
    )
  })

  it("keeps infinite values", () => {
    expect(normalizeUtcJsonTimestamp("infinity")).toBe("infinity")
    expect(normalizeUtcJsonTimestamp("-infinity")).toBe("-infinity")
  })

  it("rejects the output of a finite timestamptz, which a statement that selects the value without the read expression returns", () => {
    expect(() => normalizeUtcJsonTimestamp("2026-01-15 07:00:00+00")).toThrow(
      `Unsupported timestamptzPortable value "2026-01-15 07:00:00+00"; a statement must select it by (to_jsonb(value AT TIME ZONE INTERVAL '00:00') #>> '{}')`,
    )
  })
})

it("normalizes timestamp and time values to microseconds", () => {
  expect(normalizeTimestamp("2026-01-15 10:00:00")).toBe("2026-01-15T10:00:00.000000")
  expect(normalizeTimestamp("2026-01-15 10:00:00.1")).toBe("2026-01-15T10:00:00.100000")
  expect(normalizeTime("24:00:00")).toBe("24:00:00.000000")
  expect(normalizeTime("10:00:00.25")).toBe("10:00:00.250000")
})

it("rejects time with a time zone when decoding a local time", () => {
  for (const text of ["10:00:00+07", "10:00:00.5+00", "10:00:00.123456-03:30"]) {
    expect(() => normalizeTime(text)).toThrow(`Unsupported time value "${text}"`)
  }
})

it("normalizes dates and timestamps of years outside 1 to 9999", () => {
  expect(normalizeTimestamp("0001-01-01 00:00:00 BC")).toBe("0000-01-01T00:00:00.000000")
  expect(normalizeDate("4713-01-01 BC")).toBe("-004712-01-01")
  expect(normalizeDate("10000-01-01")).toBe("+010000-01-01")
  expect(normalizeDate("5874897-12-31")).toBe("+5874897-12-31")
  expect(normalizeDate("2026-01-15")).toBe("2026-01-15")
})

it("converts ISO 8601 years outside 1 to 9999 to PostgreSQL years", () => {
  expect(toPostgresYear("+010000-01-01T00:00:00.000Z")).toBe("10000-01-01T00:00:00.000Z")
  expect(toPostgresYear("+5874897-12-31")).toBe("5874897-12-31")
  expect(toPostgresYear("0000-01-01")).toBe("0001-01-01 BC")
  expect(toPostgresYear("-004712-01-01")).toBe("4713-01-01 BC")
  expect(toPostgresYear("2026-01-15")).toBe("2026-01-15")
  expect(toPostgresYear("-infinity")).toBe("-infinity")
})

it("formats the precision of timestamptz, timestamp, and time in their SQL types and not in their cast types", () => {
  expect([timestamptz.with(3).sqlType, timestamp.with(3).sqlType, time.with(0).sqlType]).toEqual([
    "timestamptz(3)",
    "timestamp(3)",
    "time(0)",
  ])
  expect(timestamptz.with(3).castType).toBe("timestamptz")
})

it("reads a value of timestamptzPortable by its read expression and keeps the expression with a precision", () => {
  expect(timestamptzPortable.read?.('"run_at"')).toBe(
    `(to_jsonb("run_at" AT TIME ZONE INTERVAL '00:00') #>> '{}')`,
  )
  expect([timestamptzPortable.with(3).sqlType, timestamptzPortable.with(3).castType]).toEqual([
    "timestamptz(3)",
    "timestamptz",
  ])
  expect(timestamptzPortable.with(3).read).toBe(timestamptzPortable.read)
})

describePostgres("timestamptzPortable in PostgreSQL", ({ database, testTransaction }) => {
  it("reads a value of timestamptzPortable and binds it as the same instant after DateStyle and TimeZone change", async () => {
    // The original instants in PostgreSQL input syntax, and the strings that timestamptzPortable returns for them.
    const samples: [string | null, string | null][] = [
      ["1969-12-31 23:59:59.999999+00", "1969-12-31T23:59:59.999999Z"],
      ["2026-01-15 07:00:59.999999+00", "2026-01-15T07:00:59.999999Z"],
      ["2026-01-15 07:01:00+00", "2026-01-15T07:01:00.000000Z"],
      ["0001-06-01 12:00:00.5+00 BC", "0000-06-01T12:00:00.500000Z"],
      ["0044-03-15 12:00:00+00 BC", "-000043-03-15T12:00:00.000000Z"],
      ["10000-01-01 00:00:00+00", "+010000-01-01T00:00:00.000000Z"],
      ["294276-12-31 23:59:59.999999+00", "+294276-12-31T23:59:59.999999Z"],
      ["infinity", "infinity"],
      ["-infinity", "-infinity"],
      [null, null],
    ]
    const type = timestamptzPortable.nullable()

    const values = await testTransaction(async () => {
      // A POSIX time zone whose abbreviation is UTC, which `AT TIME ZONE 'UTC'` would read as its offset of 5 hours.
      await database.script`SET LOCAL DateStyle = 'SQL, DMY'; SET LOCAL TimeZone = 'UTC+05'`
      const read: (string | null)[] = []
      for (const [original] of samples) {
        read.push(
          await database.query`
            SELECT ${unsafeSql(type.read!("v"))} FROM (SELECT ${original}::timestamptz AS v) AS sample
          `.get(type),
        )
      }
      return read
    })
    expect(values).toEqual(samples.map(sample => sample[1]))

    const equal = await testTransaction(async () => {
      await database.script`SET LOCAL DateStyle = 'German, YMD'; SET LOCAL TimeZone = 'America/St_Johns'`
      const results: boolean[] = []
      for (const [index, value] of values.entries()) {
        results.push(
          await database.query`
            SELECT ${param(type, value)} IS NOT DISTINCT FROM ${samples[index]![0]}::timestamptz
          `.get(boolean),
        )
      }
      return results
    })
    expect(equal).toEqual(samples.map(() => true))
  })
})
