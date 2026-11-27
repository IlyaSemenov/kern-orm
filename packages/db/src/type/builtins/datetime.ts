import { defineType } from "../type"
import { formatTypeName } from "../type-name"

// Date and time values are strings in fixed ISO 8601 formats, so that no precision or time zone is lost and string order is chronological for years 1 to 9999.
// Other years are astronomical ISO 8601 years like those of `Date.toISOString`, such as `+010000` and `0000` for 1 BC, converted to the PostgreSQL format on encoding.
// Parsing expects the default `DateStyle` setting (`ISO`), apart from that of `timestamptzPortable`, whose read expression does not depend on it.
// `with(precision)` sets the number of fractional digits of seconds that PostgreSQL stores.

/** Point in time as a UTC ISO 8601 string with microseconds, such as `2026-01-15T07:00:00.123456Z`; accepts a `Date` too. */
export const timestamptz = /* @__PURE__ */ defineType({ sqlType: "timestamptz" })
  .transform({ decode: normalizeTimestamptz, encode: encodeTimestamptz })
  .withParameters(/* @__PURE__ */ createPrecisionFormatter("timestamptz"))

/**
 * Point in time of a `timestamptz` column as a UTC ISO 8601 string with microseconds, as `timestamptz` returns it, read by an expression whose text does not depend on the `DateStyle` and `TimeZone` settings of the session; accepts a `Date` too.
 *
 * A statement must select a value by `(to_jsonb(value AT TIME ZONE INTERVAL '00:00') #>> '{}')`, which the columns of a record and the queries of a builder do; conditions and orders compare the value itself.
 */
export const timestamptzPortable = /* @__PURE__ */ defineType({
  sqlType: "timestamptz",
  // JSON writes a timestamp in ISO 8601 whatever the session settings, and the conversion to UTC leaves no offset to write.
  // A zero interval rather than 'UTC': a POSIX `TimeZone` such as `UTC+05` gives the abbreviation `UTC` a nonzero offset.
  read: value => `(to_jsonb(${value} AT TIME ZONE INTERVAL '00:00') #>> '{}')`,
})
  .transform({ decode: normalizeUtcJsonTimestamp, encode: encodeTimestamptz })
  .withParameters(/* @__PURE__ */ createPrecisionFormatter("timestamptz"))

/** Date and time without a time zone as an ISO 8601 string with microseconds, such as `2026-01-15T10:00:00.000000`. */
export const timestamp = /* @__PURE__ */ defineType({ sqlType: "timestamp" })
  .transform({ decode: normalizeTimestamp, encode: toPostgresYear })
  .withParameters(/* @__PURE__ */ createPrecisionFormatter("timestamp"))

/** Calendar date as an ISO 8601 string, such as `2026-01-15`. */
export const date = /* @__PURE__ */ defineType({ sqlType: "date" }).transform({
  decode: normalizeDate,
  encode: toPostgresYear,
})

/** Time of day as a string with microseconds, such as `10:00:00.000000`. */
export const time = /* @__PURE__ */ defineType({ sqlType: "time" })
  .transform({ decode: normalizeTime })
  .withParameters(/* @__PURE__ */ createPrecisionFormatter("time"))

/** Interval in the PostgreSQL output format, such as `1 day 02:00:00`. */
export const interval = /* @__PURE__ */ defineType({ sqlType: "interval" })

/** Encodes a point in time, as a UTC ISO 8601 string or a `Date`, in the PostgreSQL format of its year. */
function encodeTimestamptz(value: string | Date): string {
  return toPostgresYear(value instanceof Date ? value.toISOString() : value)
}

function createPrecisionFormatter(name: string) {
  return (precision: number) => formatTypeName(name, precision)
}

const timestamptzPattern =
  /^(\d{4,})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?([+-])(\d{2})(?::(\d{2}))?(?::(\d{2}))?( BC)?$/

const timestampPattern = /^(\d{4,})(-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?( BC)?$/

/** Timestamp that `to_jsonb` writes, which separates the time by `T`, drops trailing fractional zeros, and marks a year before 1 with a ` BC` suffix. */
const jsonTimestampPattern = /^(\d{4,})(-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?( BC)?$/

const datePattern = /^(\d{4,})(-\d{2}-\d{2})( BC)?$/

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
  // In ISO output a four-digit AD year and the UTC suffix leave only the separator and precision to change.
  if (text[4] === "-" && text[10] === " " && text.endsWith("+00")) {
    return formatLocalTimestamp(text, text.length - 3) + "Z"
  }
  if (infinities.has(text)) {
    return text
  }
  const match = timestamptzPattern.exec(text)
  if (!match) {
    throw createDateStyleError("timestamptz", text)
  }
  const offset =
    (match[8] === "-" ? -1 : 1) *
    (Number(match[9]) * 3600 + Number(match[10] ?? 0) * 60 + Number(match[11] ?? 0))
  let time = Number(match[4]) * 3600 + Number(match[5]) * 60 + Number(match[6]) - offset
  let utcDate: string
  if (time >= 0 && time < 86400 && match[1]!.length === 4 && !match[12]) {
    utcDate = text.slice(0, 10)
  } else {
    const days = countDays(
      toAstronomicalYear(match[1]!, match[12]),
      Number(match[2]),
      Number(match[3]),
    )
    const dayOffset = Math.floor(time / 86400)
    utcDate = formatDate(days + dayOffset)
    time -= dayOffset * 86400
  }
  return `${utcDate}T${padTwo(Math.floor(time / 3600))}:${padTwo(Math.floor(time / 60) % 60)}:${padTwo(time % 60)}.${padFraction(match[7])}Z`
}

/** Normalizes a `timestamp` value to ISO 8601 without a time zone, such as `2026-01-15T10:00:00.000000`. */
export function normalizeTimestamp(text: string): string {
  // A common SQL type can promote a timestamp to timestamptz, whose offset a local timestamp cannot represent.
  if (text[4] === "-" && text[10] === " " && hasLocalTimeSuffix(text, 19)) {
    return formatLocalTimestamp(text, text.length)
  }
  if (infinities.has(text)) {
    return text
  }
  const match = timestampPattern.exec(text)
  if (!match) {
    throw createDateStyleError("timestamp", text)
  }
  return formatTimestampFields(match)
}

/**
 * Normalizes the text that `to_jsonb` writes for a timestamp of a UTC instant, such as `2026-01-15T07:00:00.1234`, to the format of `timestamptz` values, such as `2026-01-15T07:00:00.123400Z`.
 *
 * It throws for text that it cannot convert, such as the output of a finite `timestamptz` that a statement selects without the read expression of `timestamptzPortable`.
 */
export function normalizeUtcJsonTimestamp(text: string): string {
  // A four-digit AD year leaves only the precision and the UTC suffix to add.
  if (text[4] === "-" && text[10] === "T" && hasLocalTimeSuffix(text, 19)) {
    return formatLocalTimestamp(text, text.length) + "Z"
  }
  if (infinities.has(text)) {
    return text
  }
  const match = jsonTimestampPattern.exec(text)
  if (!match) {
    throw new Error(
      `Unsupported timestamptzPortable value "${text}"; a statement must select it by (to_jsonb(value AT TIME ZONE INTERVAL '00:00') #>> '{}')`,
    )
  }
  return formatTimestampFields(match) + "Z"
}

/** Formats the fields of a match of `timestampPattern` or `jsonTimestampPattern` as an ISO 8601 timestamp with microseconds and an astronomical year. */
function formatTimestampFields(match: RegExpExecArray): string {
  return `${formatYear(toAstronomicalYear(match[1]!, match[5]))}${match[2]}T${match[3]}.${padFraction(match[4])}`
}

/** Formats the date and local time preceding an optional UTC suffix, for a four-digit AD year, whatever separates them. */
function formatLocalTimestamp(text: string, end: number): string {
  return text.slice(0, 10) + "T" + padTime(text.slice(11, end))
}

/** Normalizes a `date` value to ISO 8601, such as `2026-01-15`. */
export function normalizeDate(text: string): string {
  if ((text.length === 10 && text[4] === "-") || infinities.has(text)) {
    return text
  }
  const match = datePattern.exec(text)
  if (!match) {
    throw createDateStyleError("date", text)
  }
  return `${formatYear(toAstronomicalYear(match[1]!, match[3]))}${match[2]}`
}

/** Normalizes a `time` value to `HH:MM:SS.ffffff`. */
export function normalizeTime(text: string): string {
  if (text[2] !== ":" || !hasLocalTimeSuffix(text, 8)) {
    throw new Error(`Unsupported time value "${text}"`)
  }
  return padTime(text)
}

/** Checks whether the local time ends at the whole seconds or their fraction, both of which precede any PostgreSQL time zone offset. */
function hasLocalTimeSuffix(text: string, secondsEnd: number): boolean {
  return text.length === secondsEnd || /\.\d{1,6}$/.test(text)
}

function padTime(text: string): string {
  return text.length === 8 ? text + ".000000" : text.padEnd(15, "0")
}

/** Creates the error of a value of `type` in an output format of another `DateStyle` than `ISO`. */
function createDateStyleError(type: string, text: string): Error {
  return new Error(
    `Unsupported ${type} value "${text}"; kern-db expects DateStyle ISO, which the connection options of the client can set`,
  )
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
