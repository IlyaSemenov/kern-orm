import { orderingOperators } from "../../expression/operators/ordering"
import { defineType } from "../type"
import { formatTypeName } from "../type-name"

// Date and time values are strings in fixed ISO 8601 formats, so that no precision or time zone is lost and string order is chronological for years 1 to 9999.
// Other years are astronomical ISO 8601 years like those of `Date.toISOString`, such as `+010000` and `0000` for 1 BC, converted to the PostgreSQL format on encoding.
// Parsing expects the default `DateStyle` setting (`ISO`).
// `with(precision)` sets the number of fractional digits of seconds that PostgreSQL stores.

/** Point in time as a UTC ISO 8601 string with microseconds, such as `2026-01-15T07:00:00.123456Z`; accepts a `Date` too. */
export const timestamptz = /* @__PURE__ */ defineType({ sqlType: "timestamptz" })
  .transform({
    decode: normalizeTimestamptz,
    encode: (value: string | Date) =>
      toPostgresYear(value instanceof Date ? value.toISOString() : value),
  })
  .withOperators(orderingOperators)
  .withParameters(/* @__PURE__ */ createPrecisionFormatter("timestamptz"))

/** Date and time without a time zone as an ISO 8601 string with microseconds, such as `2026-01-15T10:00:00.000000`. */
export const timestamp = /* @__PURE__ */ defineType({ sqlType: "timestamp" })
  .transform({ decode: normalizeTimestamp, encode: toPostgresYear })
  .withOperators(orderingOperators)
  .withParameters(/* @__PURE__ */ createPrecisionFormatter("timestamp"))

/** Calendar date as an ISO 8601 string, such as `2026-01-15`. */
export const date = /* @__PURE__ */ defineType({ sqlType: "date" })
  .transform({ decode: normalizeDate, encode: toPostgresYear })
  .withOperators(orderingOperators)

/** Time of day as a string with microseconds, such as `10:00:00.000000`. */
export const time = /* @__PURE__ */ defineType({ sqlType: "time" })
  .transform({ decode: normalizeTime })
  .withOperators(orderingOperators)
  .withParameters(/* @__PURE__ */ createPrecisionFormatter("time"))

/** Interval in the PostgreSQL output format, such as `1 day 02:00:00`. */
export const interval = /* @__PURE__ */ defineType({ sqlType: "interval" }).withOperators(
  orderingOperators,
)

function createPrecisionFormatter(name: string) {
  return (precision: number) => formatTypeName(name, precision)
}

const timestamptzPattern =
  /^(\d{4,})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?([+-])(\d{2})(?::(\d{2}))?(?::(\d{2}))?( BC)?$/

const timestampPattern = /^(\d{4,})(-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?( BC)?$/

const datePattern = /^(\d{4,})(-\d{2}-\d{2})( BC)?$/

const timePattern = /^(\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/

/** Leading ISO 8601 year that PostgreSQL does not accept: an expanded year, such as `+010000`, or year `0000`. */
const isoYearPattern = /^([+-]\d{6,}|0000)(-.*)$/s

/** Special date and time values that PostgreSQL returns as they are. */
const infinities = new Set(["infinity", "-infinity"])

/**
 * Normalizes a `timestamptz` value to UTC ISO 8601 with microseconds, such as `2026-01-15T07:00:00.123456Z`.
 *
 * The fixed format keeps microseconds that `Date` would lose; the arithmetic avoids `Date`, whose range is narrower than that of PostgreSQL.
 */
export function normalizeTimestamptz(text: string): string {
  if (infinities.has(text)) {
    return text
  }
  const match = timestamptzPattern.exec(text)
  if (!match) {
    throw new Error(`Unsupported timestamptz value "${text}"; kern-orm expects DateStyle ISO`)
  }
  const offset =
    (match[8] === "-" ? -1 : 1) *
    (Number(match[9]) * 3600 + Number(match[10] ?? 0) * 60 + Number(match[11] ?? 0))
  const seconds =
    countDays(toAstronomicalYear(match[1]!, match[12]), Number(match[2]), Number(match[3])) *
      86400 +
    Number(match[4]) * 3600 +
    Number(match[5]) * 60 +
    Number(match[6]) -
    offset
  const days = Math.floor(seconds / 86400)
  const time = seconds - days * 86400
  return `${formatDate(days)}T${padTwo(Math.floor(time / 3600))}:${padTwo(Math.floor(time / 60) % 60)}:${padTwo(time % 60)}.${padFraction(match[7])}Z`
}

/** Normalizes a `timestamp` value to ISO 8601 without a time zone, such as `2026-01-15T10:00:00.000000`. */
export function normalizeTimestamp(text: string): string {
  if (infinities.has(text)) {
    return text
  }
  const match = timestampPattern.exec(text)
  if (!match) {
    throw new Error(`Unsupported timestamp value "${text}"; kern-orm expects DateStyle ISO`)
  }
  return `${formatYear(toAstronomicalYear(match[1]!, match[5]))}${match[2]}T${match[3]}.${padFraction(match[4])}`
}

/** Normalizes a `date` value to ISO 8601, such as `2026-01-15`. */
export function normalizeDate(text: string): string {
  if (infinities.has(text)) {
    return text
  }
  const match = datePattern.exec(text)
  if (!match) {
    throw new Error(`Unsupported date value "${text}"; kern-orm expects DateStyle ISO`)
  }
  return `${formatYear(toAstronomicalYear(match[1]!, match[3]))}${match[2]}`
}

/** Normalizes a `time` value to `HH:MM:SS.ffffff`. */
export function normalizeTime(text: string): string {
  const match = timePattern.exec(text)
  if (!match) {
    throw new Error(`Unsupported time value "${text}"`)
  }
  return `${match[1]}.${padFraction(match[2])}`
}

/** Converts a leading ISO 8601 year outside 1 to 9999 into the PostgreSQL format: unsigned after 9999 and with a `BC` suffix before 1. */
export function toPostgresYear(text: string): string {
  const match = isoYearPattern.exec(text)
  if (!match) {
    return text
  }
  const year = Number(match[1])
  return year > 0 ? `${year}${match[2]}` : `${String(1 - year).padStart(4, "0")}${match[2]} BC`
}

/** Returns the astronomical year of a PostgreSQL year, where 1 BC is year 0. */
function toAstronomicalYear(year: string, era: string | undefined): number {
  return era === undefined ? Number(year) : 1 - Number(year)
}

/** Formats an astronomical year as an ISO 8601 year, expanded with a sign outside 0 to 9999. */
function formatYear(year: number): string {
  if (year >= 0 && year <= 9999) {
    return String(year).padStart(4, "0")
  }
  return `${year < 0 ? "-" : "+"}${String(Math.abs(year)).padStart(6, "0")}`
}

// The day arithmetic follows the proleptic Gregorian calendar of PostgreSQL, counting days from 1970-01-01 (http://howardhinnant.github.io/date_algorithms.html).

/** Counts the days from 1970-01-01 to a date of an astronomical year. */
function countDays(year: number, month: number, day: number): number {
  const shifted = month <= 2 ? year - 1 : year
  const era = Math.floor(shifted / 400)
  const yearOfEra = shifted - era * 400
  const dayOfYear = Math.floor((153 * (month > 2 ? month - 3 : month + 9) + 2) / 5) + day - 1
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear
  return era * 146097 + dayOfEra - 719468
}

/** Formats the date a number of days after 1970-01-01 as an ISO 8601 date. */
function formatDate(days: number): string {
  const shifted = days + 719468
  const era = Math.floor(shifted / 146097)
  const dayOfEra = shifted - era * 146097
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  )
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100))
  const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153)
  const day = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1
  const month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0)
  return `${formatYear(year)}-${padTwo(month)}-${padTwo(day)}`
}

function padTwo(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

function padFraction(fraction: string | undefined): string {
  return (fraction ?? "").padEnd(6, "0")
}
