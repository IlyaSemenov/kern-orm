import type { DriverResult, TextValue } from "../database/driver"
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

/** Field of a record in the template of a result plan: its key and its value before the values of a row are assigned. */
export interface RecordTemplateField {
  readonly key: string
  readonly value: unknown
}

/** How code converts the decoded result of a query, by `map` and `transform` of the query: `map` runs before `transform`, since `map` does not apply after `transform`. */
export interface ResultConversion {
  /** Converts each record or value, also `null` of a `NULL` value, and is not called for a missing row. */
  readonly map: ((row: unknown) => unknown) | undefined
  /** Converts the whole result, once: an array of rows, one row, or `null` or `undefined` of a missing row. */
  readonly transform: ((result: unknown) => unknown) | undefined
}

/**
 * How a query returns its rows: `many` as an array; `one` as one row, rejecting without it; `nullable` as one row or `null` without it; `optional` as one row or `undefined` without it.
 *
 * Without a row, a query of rows `one` rejects with `NotFoundError`, executed or nested, or with `RequiredRelationError` when a required relation guarantees the row.
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
  /** Required relation that guarantees the row of nested rows `one`, such as `field.form`, whose missing row is a `RequiredRelationError` rather than a `NotFoundError`. */
  readonly guaranteedBy?: string | undefined
  /**
   * Every field of a record in its order, with the values of its literals, which a row does not hold; `undefined` for a query without literals.
   *
   * A record starts from it, so its keys keep their order whichever of them a row holds.
   */
  readonly recordTemplate?: readonly RecordTemplateField[] | undefined
  /** How code converts the result that the plan decodes; `undefined` for a query without `transform` and `map`. */
  readonly conversion?: ResultConversion | undefined
}

/** Result plan of a compiled statement: the plan of its rows, and how a mutation that returns no fields reads the number of the rows it changes. */
export interface StatementPlan extends ResultPlan {
  /**
   * How the result reads the number of the rows that a mutation without `RETURNING` changes, which only its command tag gives: `number` resolves to the number, and `records` to as many records without fields, for a mutation that selects none.
   * `undefined` for a statement whose rows are its result.
   */
  readonly counted: "number" | "records" | undefined
  /** Whether the fields are read from the result columns of their keys, or a value from the only column, as for a statement of SQL text, rather than from the columns in their order. */
  readonly named: boolean
}

/** Error thrown when a query of one row finds no row, executed or nested, unless a required relation guarantees the row. */
export class NotFoundError extends Error {
  override readonly name = "NotFoundError"
  /** Path of the missing nested rows from the result field that holds them, such as `user` or `fields[2].form`, after the index of the row of an executed query of rows `many`, such as `[2].form`; `undefined` when the executed query itself finds no row. */
  readonly path: string | undefined

  constructor(message: string, path?: string) {
    super(message)
    this.path = path
  }
}

/**
 * Error thrown when a required relation, such as `field.form`, has no record for a row.
 *
 * A required relation promises the record, so its absence means that the database breaks the promise, such as without a foreign key, or that the relation should not be required.
 */
export class RequiredRelationError extends Error {
  override readonly name = "RequiredRelationError"

  constructor(
    /** Relation by the key of its table and its name, such as `field.form`. */
    readonly relation: string,
    /** Path of the field of the relation from the result field that holds it, such as `fields[2].form`, after the index of the row of an executed query of rows `many`, such as `[2].form`. */
    readonly path: string,
  ) {
    super(`Required relation "${relation}" has no record for result field "${path}"`)
  }
}

/** Error thrown when a row does not match the result fields, a value fails to decode, or a callback of `transform` or `map` fails; the failure is its cause. */
export class ResultDecodeError extends Error {
  override readonly name = "ResultDecodeError"

  constructor(
    message: string,
    /**
     * Path of the value from its result field, such as `fields[2].label`, after the index of the row of an executed query of rows `many`, such as `[2].label`.
     *
     * A callback of `map` that fails has the path of its row, such as `fields[2]` or `[2]`, and one of `transform` the path of the field of its nested rows, such as `fields`.
     * It is `undefined` for a row of the driver of another width than the result fields, and for a callback that fails on the only row or the whole result of an executed query.
     */
    readonly path: string | undefined,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

/** Tells whether `key` can be a key of a decoded record, such as a column key: assigning `__proto__` would change the prototype of the record instead. */
export function isRecordKey(key: string): boolean {
  return key !== "__proto__"
}

/**
 * Decodes the result of a statement by its plan: its rows, as `decodeResult` does, or the number of the rows of its command tag, such as of the rows that a mutation changes.
 *
 * A statement of one row that returns its number or a record without fields rejects as a query of one row does: with `NotFoundError` without a row, unless it is optional or nullable, and with several rows.
 */
export function decodeStatement(plan: StatementPlan, result: DriverResult): unknown {
  const { counted, conversion } = plan
  if (counted === undefined) {
    return decodeResult(plan, plan.named ? selectColumns(plan, result) : result.rows)
  }
  const decoded = decodeCount(plan, counted, result.count)
  // A mutation of a missing row that resolves to the number of the rows has that number as its result, so only records can be missing.
  return conversion === undefined
    ? decoded
    : convertTopResult(
        plan,
        conversion,
        decoded,
        counted === "records" && plan.rows !== "many" && result.count === 0,
      )
}

/** Returns what a statement resolves to by `count`, the number of the rows of its command tag, as `counted` tells: the number, or as many records without fields. */
function decodeCount(plan: StatementPlan, counted: "number" | "records", count: number): unknown {
  if (plan.rows !== "many") {
    // The command tag of a statement of SQL text counts the rows that it changes or returns, whichever its command is.
    if (count > 1) {
      throw new Error(
        plan.named
          ? `Query of one row reported ${count} rows`
          : `Query of one row changed ${count} rows`,
      )
    }
    if (count === 0) {
      if (plan.rows === "one") {
        throw new NotFoundError(
          plan.named ? "Query reported no rows" : "Query found no row to change",
        )
      }
      if (counted === "records") {
        return decodeMissing(plan)
      }
    }
  }
  if (counted === "number") {
    return count
  }
  // Records without values of a row for the changed rows, which PostgreSQL cannot return, since it rejects `RETURNING` without fields.
  if (plan.rows !== "many") {
    return createRecord(plan)
  }
  const records: object[] = []
  for (let index = 0; index < count; index++) {
    records.push(createRecord(plan))
  }
  return records
}

/**
 * Returns the rows of `result` with the values of the fields of `plan` in their order, read from the result columns of their keys: a value from the only column.
 *
 * It rejects a missing column or one that the result has twice, and other columns than one for a value; it ignores the other columns of records.
 */
function selectColumns(plan: ResultPlan, result: DriverResult): DriverResult["rows"] {
  const { columns, rows } = result
  if (plan.value) {
    if (columns.length !== 1) {
      throw new ResultDecodeError(
        `Statement returned ${columns.length} columns for one value`,
        undefined,
      )
    }
    return rows
  }
  const { fields } = plan
  const indexes: number[] = []
  // The rows are read as they are when the fields are exactly the columns in their order.
  let ordered = fields.length === columns.length
  for (let index = 0; index < fields.length; index++) {
    const { key } = fields[index]!
    const column = columns.indexOf(key)
    if (column === -1) {
      throw new ResultDecodeError(`Statement returned no column "${key}"`, undefined)
    }
    if (columns.indexOf(key, column + 1) !== -1) {
      throw new ResultDecodeError(`Statement returned column "${key}" more than once`, undefined)
    }
    indexes.push(column)
    ordered &&= column === index
  }
  if (ordered) {
    return rows
  }
  const selected: (readonly TextValue[])[] = []
  for (let row = 0; row < rows.length; row++) {
    const values: TextValue[] = []
    for (let index = 0; index < indexes.length; index++) {
      values.push(rows[row]![indexes[index]!]!)
    }
    selected.push(values)
  }
  return selected
}

/**
 * Decodes driver rows into the result of a query by its result plan, and converts the result as its conversion tells.
 *
 * It rejects a row whose values do not match the result fields, and names the path of the value that fails to decode from its result field, such as `fields[2].label`, after the index of the row of rows `many`, such as `[2].fields[2].label`.
 */
export function decodeResult(plan: ResultPlan, rows: DriverResult["rows"]): unknown {
  const result = decodeRows(plan, rows)
  const { conversion } = plan
  return conversion === undefined
    ? result
    : convertTopResult(plan, conversion, result, rows.length === 0)
}

/** Converts `result`, which `plan` decoded for a statement rather than for nested rows, as `convertResult` does, rejecting with the error of the statement. */
function convertTopResult(
  plan: ResultPlan,
  conversion: ResultConversion,
  result: unknown,
  missing: boolean,
): unknown {
  try {
    return convertResult(plan, conversion, result, missing)
  } catch (error) {
    // Only `map` of rows `many` tells a path here, the index of its row: the whole result and the only row have no field.
    throw error instanceof NestedFailure
      ? createRowError("", error)
      : new ResultDecodeError(`Cannot convert the result${describeCause(error)}`, undefined, {
          cause: error,
        })
  }
}

/**
 * Converts `result`, which `plan` decoded, by `conversion`.
 *
 * It tells a missing row by `missing` rather than by the value, since a row may decode to `null` or `undefined`.
 * A failure of `map` of rows `many` is a `NestedFailure` of the index of its row; any other failure is the error of the callback, which the enclosing field adds its path to.
 */
function convertResult(
  plan: ResultPlan,
  conversion: ResultConversion,
  result: unknown,
  missing: boolean,
): unknown {
  const { map, transform } = conversion
  let converted = result
  if (map !== undefined) {
    if (plan.rows === "many") {
      // Decoding creates the array of rows, so it is converted in place.
      const rows = result as unknown[]
      let index = 0
      try {
        for (; index < rows.length; index++) {
          rows[index] = map(rows[index])
        }
      } catch (error) {
        throw new NestedFailure(`[${index}]`, error)
      }
    } else if (!missing) {
      converted = map(result)
    }
  }
  return transform === undefined ? converted : transform(converted)
}

/** Decodes driver rows into the result of a query before its conversion: an array of rows `many`, one row, or the result of a missing row. */
function decodeRows(plan: ResultPlan, rows: DriverResult["rows"]): unknown {
  if (plan.rows === "many") {
    const results: unknown[] = []
    // One try per query rather than per row; the index tells which row failed.
    let index = 0
    try {
      for (; index < rows.length; index++) {
        results.push(decodeRow(plan, rows[index]!, false))
      }
    } catch (error) {
      throw createRowError(`[${index}].`, error)
    }
    return results
  }
  // A query of one row may have no limit, such as a relation that requires at most one match.
  if (rows.length > 1) {
    throw new Error(`Query of one row returned ${rows.length} rows`)
  }
  const row = rows[0]
  if (row === undefined) {
    // A query of a relation runs only nested in the row of its parent, so no relation guarantees the row of an executed query.
    if (plan.rows === "one") {
      throw new NotFoundError("Query returned no rows")
    }
    return decodeMissing(plan)
  }
  try {
    return decodeRow(plan, row, false)
  } catch (error) {
    throw createRowError("", error)
  }
}

/** Returns the result of a query of rows `nullable` or `optional` without a row: `null` or `undefined`. */
function decodeMissing(plan: ResultPlan): null | undefined {
  return plan.rows === "nullable" ? null : undefined
}

/** Missing row of nested rows `one`, which the query turns into its error once the path is known. */
class MissingRow extends Error {
  constructor(readonly guaranteedBy: string | undefined) {
    super()
  }
}

/**
 * Failure inside a row, with the path to it, such as `[2].label` from the field of nested rows or `fields[2].label` from a row of the driver: a missing row or a value that fails to decode.
 *
 * Every enclosing level adds its own part of the path, and the query turns it into its error.
 */
class NestedFailure extends Error {
  constructor(
    readonly path: string,
    override readonly cause: unknown,
  ) {
    super()
  }
}

/** Adds `segment` before the path of a failure inside a row. */
function prefixPath(segment: string, error: unknown): NestedFailure {
  return error instanceof NestedFailure
    ? new NestedFailure(segment + error.path, error.cause)
    : new NestedFailure(segment, error)
}

/**
 * Creates the error of a query from the failure of a row of the driver, adding `prefix`, such as the index of the row, before its path: `NotFoundError` or `RequiredRelationError` for a missing row of nested rows, and `ResultDecodeError` for a value that fails to decode.
 *
 * A missing row keeps its class wherever it is nested, so it is never reported as a decoding failure.
 * A row of another width than the result fields is already the error of the query.
 */
function createRowError(prefix: string, error: unknown): unknown {
  if (!(error instanceof NestedFailure)) {
    return error
  }
  const path = prefix + error.path
  const { cause } = error
  if (cause instanceof MissingRow) {
    return cause.guaranteedBy === undefined
      ? new NotFoundError(`Nested query of result field "${path}" returned no rows`, path)
      : new RequiredRelationError(cause.guaranteedBy, path)
  }
  return new ResultDecodeError(
    `Cannot decode result field "${path}"${describeCause(cause)}`,
    path,
    {
      cause,
    },
  )
}

/** Describes the failure `cause` at the end of the message of an error. */
function describeCause(cause: unknown): string {
  // Only an Error contributes its message: converting another thrown value to a string can throw itself.
  return cause instanceof Error ? `: ${cause.message}` : ""
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
    // The field that holds a packed row adds the path to its failure.
    if (packed) {
      throw new Error(`Nested row of ${row.length} values for ${fields.length} result fields`)
    }
    throw new ResultDecodeError(
      `Driver returned a row of ${row.length} values for ${fields.length} result fields`,
      undefined,
    )
  }
  // One try per row rather than per value; the index tells which field failed.
  let index = 0
  try {
    if (plan.value) {
      return packed ? decodePackedValue(fields[0]!, row[0]) : decodeDriverValue(fields[0]!, row[0])
    }
    const record = createRecord(plan)
    for (; index < fields.length; index++) {
      const field = fields[index]!
      record[field.key] = packed
        ? decodePackedValue(field, row[index])
        : decodeDriverValue(field, row[index])
    }
    return record
  } catch (error) {
    const { key } = fields[index]!
    // A query of rows `many` adds the index of the row of the driver before the path.
    throw prefixPath(packed ? `.${key}` : key, error)
  }
}

/** Creates a record of `plan` before the values of a row are assigned: empty, or with the fields of its template. */
function createRecord(plan: ResultPlan): Record<string, unknown> {
  const record: Record<string, unknown> = {}
  const { recordTemplate } = plan
  if (recordTemplate !== undefined) {
    for (let index = 0; index < recordTemplate.length; index++) {
      const { key, value } = recordTemplate[index]!
      record[key] = value
    }
  }
  return record
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

/** Decodes the rows of a nested query from JSON, as `decodeNestedRows` does, and converts them as the conversion of `plan` tells. */
function decodeNested(plan: ResultPlan, json: unknown): unknown {
  const result = decodeNestedRows(plan, json)
  const { conversion } = plan
  // The field that holds the rows adds its path to a failure.
  return conversion === undefined ? result : convertResult(plan, conversion, result, json === null)
}

/** Decodes the rows of a nested query from JSON: an array of packed rows for rows `many`, and a packed row or `null` otherwise. */
function decodeNestedRows(plan: ResultPlan, json: unknown): unknown {
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
      throw new MissingRow(plan.guaranteedBy)
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
