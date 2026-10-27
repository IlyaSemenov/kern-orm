import type { DriverResult } from "../execution/driver"
import type { AnyType } from "../type/type"

/** Field of a compiled result: the key of a record and how its value is decoded. */
export type ResultField = ScalarField | NestedField

/** Field of a value decoded by its type from its PostgreSQL text representation. */
export interface ScalarField {
  readonly key: string
  readonly type: AnyType
  readonly nested?: undefined
}

/**
 * Field of the rows of a nested query packed as JSON, decoded by the result plan of that query.
 *
 * Rows `many` are an array of packed rows, and the other rows modes are one packed row or `null` without a row.
 * A packed row is an array of the values of its fields in their order: the PostgreSQL text representation of a scalar or `null` for SQL `NULL`, and JSON for nested rows.
 */
export interface NestedField {
  readonly key: string
  readonly nested: ResultPlan
}

/**
 * How a query returns its rows: `many` as an array; `one` as one row, rejecting without it; `nullable` as one row or `null` without it; `optional` as one row or `undefined` without it.
 *
 * Without a row, a query of rows `one` rejects: an executed query with `NotFoundError`, and nested rows with a decoding error.
 * This mode does not imply a SQL limit: `take` and `get` add `LIMIT 1` only when they change `many` to `one`.
 */
export type ResultRows = "many" | "one" | "nullable" | "optional"

/** How the rows of a query become its result, apart from its fields. */
export interface ResultMode {
  readonly rows: ResultRows
  /** A row is the value of its only field instead of a record. */
  readonly value: boolean
}

/** Fields of the rows of a query and how its rows become its result. */
export interface ResultPlan extends ResultMode {
  /** Fields of a row, in the order of its values. */
  readonly fields: readonly ResultField[]
}

/** Error thrown when a query requires one row but finds none. */
export class NotFoundError extends Error {
  override readonly name = "NotFoundError"
}

/** Tells whether `key` can be a key of a decoded record, such as a column key: assigning `__proto__` would change the prototype of the record instead. */
export function isRecordKey(key: string): boolean {
  return key !== "__proto__"
}

/**
 * Decodes driver rows into the result of a query by its result plan.
 *
 * It rejects a row whose values do not match the result fields, and names the path of the value that fails to decode from its result field, such as `fields[2].label`.
 */
export function decodeResult(plan: ResultPlan, rows: DriverResult["rows"]): unknown {
  if (plan.rows === "many") {
    const results: unknown[] = []
    for (const row of rows) {
      results.push(decodeRow(plan, row, false))
    }
    return results
  }
  // A query of one row may have no limit, such as a relation that requires at most one match.
  if (rows.length > 1) {
    throw new Error(`Query of one row returned ${rows.length} rows`)
  }
  const row = rows[0]
  if (row === undefined) {
    if (plan.rows === "one") {
      throw new NotFoundError("Query returned no rows")
    }
    return decodeMissing(plan)
  }
  return decodeRow(plan, row, false)
}

/** Returns the result of a query of rows `nullable` or `optional` without a row: `null` or `undefined`. */
function decodeMissing(plan: ResultPlan): null | undefined {
  return plan.rows === "nullable" ? null : undefined
}

/**
 * Failure to decode a value inside nested rows, with the path to it from the field that holds them, such as `[2].label`.
 *
 * Every enclosing level adds its own part of the path, and the row of the driver turns it into the error of its field.
 */
class NestedValueError extends Error {
  constructor(
    readonly path: string,
    override readonly cause: unknown,
  ) {
    super()
  }
}

/** Adds `segment` before the path of a failure inside nested rows. */
function prefixPath(segment: string, error: unknown): NestedValueError {
  return error instanceof NestedValueError
    ? new NestedValueError(segment + error.path, error.cause)
    : new NestedValueError(segment, error)
}

/**
 * Decodes a row into a record keyed by the result fields, or into the value of its only field.
 *
 * A row of the driver holds text and `null`; a packed row of nested rows holds parsed JSON.
 */
function decodeRow(plan: ResultPlan, row: readonly unknown[], packed: boolean): unknown {
  const { fields } = plan
  // A row of another width does not match the result plan, rather than having NULL values.
  if (row.length !== fields.length) {
    throw new Error(
      `${packed ? "Nested" : "Driver returned a"} row of ${row.length} values for ${fields.length} result fields`,
    )
  }
  // One try per row rather than per value; the index tells which field failed.
  let index = 0
  try {
    if (plan.value) {
      return packed ? decodePackedValue(fields[0]!, row[0]) : decodeDriverValue(fields[0]!, row[0])
    }
    const record: Record<string, unknown> = {}
    for (; index < fields.length; index++) {
      const field = fields[index]!
      record[field.key] = packed
        ? decodePackedValue(field, row[index])
        : decodeDriverValue(field, row[index])
    }
    return record
  } catch (error) {
    const { key } = fields[index]!
    if (packed) {
      throw prefixPath(`.${key}`, error)
    }
    const nested = error instanceof NestedValueError
    const cause = nested ? error.cause : error
    // Only an Error contributes its message: converting another thrown value to a string can throw itself.
    const detail = cause instanceof Error ? `: ${cause.message}` : ""
    throw new Error(`Cannot decode result field "${key}${nested ? error.path : ""}"${detail}`, {
      cause,
    })
  }
}

/** Decodes the value of a field in a row of the driver: a scalar from its text, keeping `NULL` as `null`, or nested rows from JSON text. */
function decodeDriverValue(field: ResultField, value: unknown): unknown {
  if (value === undefined) {
    throw new Error("Driver returned no value")
  }
  if (field.nested !== undefined) {
    return decodeNested(field.nested, value === null ? null : JSON.parse(value as string))
  }
  return value === null ? null : field.type.decode(value as string)
}

/** Decodes the value of a field in a packed row: a scalar from its text, keeping JSON `null` as `null`, or nested rows from parsed JSON. */
function decodePackedValue(field: ResultField, value: unknown): unknown {
  if (field.nested !== undefined) {
    return decodeNested(field.nested, value)
  }
  if (value === null) {
    return null
  }
  if (typeof value !== "string") {
    throw new TypeError(`Nested value must be text, not ${describeJson(value)}`)
  }
  return field.type.decode(value)
}

/** Decodes the rows of a nested query from JSON: an array of packed rows for rows `many`, and a packed row or `null` otherwise. */
function decodeNested(plan: ResultPlan, json: unknown): unknown {
  if (plan.rows === "many") {
    if (!Array.isArray(json)) {
      throw new TypeError(`Nested rows must be an array, not ${describeJson(json)}`)
    }
    const results: unknown[] = []
    let index = 0
    try {
      for (; index < json.length; index++) {
        results.push(decodePackedRow(plan, json[index]))
      }
    } catch (error) {
      throw prefixPath(`[${index}]`, error)
    }
    return results
  }
  if (json === null) {
    if (plan.rows === "one") {
      throw new Error("Nested query of one row returned no rows")
    }
    return decodeMissing(plan)
  }
  return decodePackedRow(plan, json)
}

/** Decodes a packed row, which must be an array. */
function decodePackedRow(plan: ResultPlan, json: unknown): unknown {
  if (!Array.isArray(json)) {
    throw new TypeError(`Nested row must be an array, not ${describeJson(json)}`)
  }
  return decodeRow(plan, json, true)
}

/** Describes the kind of a parsed JSON value for an error message. */
function describeJson(value: unknown): string {
  if (value === null) {
    return "null"
  }
  if (typeof value === "object") {
    return Array.isArray(value) ? "an array" : "an object"
  }
  return `a ${typeof value}`
}
