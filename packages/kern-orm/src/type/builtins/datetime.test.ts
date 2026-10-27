import { describe, expect, it } from "bun:test"

import {
  normalizeDate,
  normalizeTime,
  normalizeTimestamp,
  normalizeTimestamptz,
  toPostgresYear,
} from "./datetime"

describe("normalizeTimestamptz", () => {
  it("converts the session time zone to UTC and keeps microseconds", () => {
    expect(normalizeTimestamptz("2026-01-15 14:00:00.123456+07")).toBe(
      "2026-01-15T07:00:00.123456Z",
    )
    expect(normalizeTimestamptz("2026-01-15 00:10:00-03:30")).toBe("2026-01-15T03:40:00.000000Z")
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

it("normalizes timestamp and time values to microseconds", () => {
  expect(normalizeTimestamp("2026-01-15 10:00:00")).toBe("2026-01-15T10:00:00.000000")
  expect(normalizeTime("10:00:00.25")).toBe("10:00:00.250000")
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
