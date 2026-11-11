// Results of statements: how rows modes make the rows of a statement its result, the keys that a decoded record can have, the errors of a result that breaks its contract, and the decoding of flat results, whose rows hold no nested rows.

import type { AnyCodec } from "./codec/codec"
import type { DriverResult, TextValue } from "./driver"

/**
 * How a query returns its rows: `many` as an array; `one` as one row, rejecting without it; `nullable` as one row or `null` without it; `optional` as one row or `undefined` without it.
 *
 * A query of one row rejects several rows, since the mode implies no SQL limit.
 */
export type ResultRows = "many" | "one" | "nullable" | "optional"

/** How the rows of a query become its result, apart from its fields. */
export interface ResultMode {
  readonly rows: ResultRows
  /** A row is the value of its only field instead of a record. */
  readonly value: boolean
}

/** Rows mode after `take`: `many` becomes `one`; the modes of one row stay. */
export type OneRow<Rows extends ResultRows> = Rows extends "many" ? "one" : Rows

// The value of a missing record is never `null`, which would read as a `NULL` value.
/** Rows mode after `pluck`: `nullable` becomes `optional`; the other modes stay. */
export type ValueRows<Rows extends ResultRows> = Rows extends "nullable" ? "optional" : Rows

/** Rows mode after `get`: `many` becomes `one` and `nullable` becomes `optional`; `one` and `optional` stay. */
export type OneValueRows<Rows extends ResultRows> = Rows extends "many"
  ? "one"
  : Rows extends "nullable"
    ? "optional"
    : Rows

/** Result of rows of `Result` returned in rows mode `Rows`; a union of modes gives the union of their results. */
export type ResultByRows<Result, Rows extends ResultRows> = Rows extends "many"
  ? Result[]
  : Rows extends "one"
    ? Result
    : Rows extends "nullable"
      ? Result | null
      : Result | undefined

/** Returns the rows mode after `pluck` of a query of rows mode `rows`, as `ValueRows` gives it in types. */
export function toValueRows(rows: ResultRows): ResultRows {
  return rows === "nullable" ? "optional" : rows
}

/** Error thrown when a query of one row finds no row, unless the code that decodes the row tells another reason, such as a broken guarantee of the row. */
export class NotFoundError extends Error {
  override readonly name = "NotFoundError"
  /** Path of the missing rows nested in a field, such as `user` or `fields[2].form`, after the index of the row of a query of rows `many`, such as `[2].form`; `undefined` when the query itself finds no row. */
  readonly path: string | undefined

  constructor(message: string, path?: string) {
    super(message)
    this.path = path
  }
}

/** Field of a flat result: the key of a record, which names the result column of its value, and the codec that decodes the value. */
export interface FlatField {
  readonly key: string
  readonly codec: AnyCodec
}

/** How a flat result decodes the result of a statement. */
export interface FlatResultPlan extends ResultMode {
  /**
   * Fields read from the result columns of their keys, or from the only column for a value, whatever its name; `undefined` for a result that is the number of the rows of the command tag.
   *
   * The key of the field of a value names it only in decoding errors.
   */
  readonly fields: readonly FlatField[] | undefined
}

/** Error thrown when a row does not match the fields of its query, or a value fails to decode or to convert; the failure is its cause. */
export class ResultDecodeError extends Error {
  override readonly name = "ResultDecodeError"

  constructor(
    message: string,
    /**
     * Path of the value from its result field, such as `fields[2].label`, after the index of the row of a query of rows `many`, such as `[2].label`.
     *
     * A conversion of a row that fails has the path of its row, such as `fields[2]` or `[2]`, and a conversion of nested rows as a whole the path of their field, such as `fields`.
     * It is `undefined` for a failure that no value causes, such as a row of another width than the fields, and for a conversion that fails on the only row or the whole result of a query.
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
 * Returns the only row of `rows` of a query of one row in the rows mode of `plan`, or `undefined` without a row.
 *
 * It rejects several rows, since the query may have no limit, such as a query that requires at most one match, and no row of rows `one` with `NotFoundError`.
 */
export function takeOnlyRow<Row>(plan: ResultMode, rows: readonly Row[]): Row | undefined {
  if (rows.length > 1) {
    throw new Error(`Query of one row returned ${rows.length} rows`)
  }
  const row = rows[0]
  if (row === undefined && plan.rows === "one") {
    throw new NotFoundError("Query returned no rows")
  }
  return row
}

/** Returns the result of a query of rows `nullable` or `optional` in the mode of `plan` without a row: `null` or `undefined`. */
export function toMissingResult(plan: ResultMode): null | undefined {
  return plan.rows === "nullable" ? null : undefined
}

/** Describes the failure `cause` at the end of the message of an error. */
export function describeCause(cause: unknown): string {
  // Only an Error contributes its message: converting another thrown value to a string can throw itself.
  return cause instanceof Error ? `: ${cause.message}` : ""
}

/** Creates the error of a value at `path` of a result that fails to decode, such as `[2].label`, with the failure as its cause. */
export function createFieldDecodeError(path: string, cause: unknown): ResultDecodeError {
  return new ResultDecodeError(
    `Cannot decode result field "${path}"${describeCause(cause)}`,
    path,
    {
      cause,
    },
  )
}

/**
 * Decodes the result of a statement by a flat plan: its rows, or the number of the rows of its command tag for a plan without fields.
 *
 * Fields are read from the result columns of their keys rather than by position, since the statement chooses the order of its columns: a missing column, a column that the result has twice, and another number of columns than one for a value reject with `ResultDecodeError`, and the other columns of records are ignored.
 * A row of the driver of another width than the result columns rejects too, rather than reading a missing value as `NULL`.
 * A number of rows of a query of one row rejects as its rows do, with `NotFoundError` without a row unless it is optional or nullable, and with several rows.
 */
export function decodeFlatResult(plan: FlatResultPlan, result: DriverResult): unknown {
  const { fields } = plan
  if (fields === undefined) {
    return decodeCount(plan, result.count)
  }
  const columns = findColumns(plan, fields, result.columns)
  const width = result.columns.length
  const { rows } = result
  if (plan.rows === "many") {
    const results: unknown[] = []
    // One try per query rather than per row; the index tells which row failed.
    let index = 0
    try {
      for (; index < rows.length; index++) {
        results.push(decodeFlatRow(plan, fields, columns, width, rows[index]!))
      }
    } catch (error) {
      throw toFieldError(`[${index}].`, error)
    }
    return results
  }
  const row = takeOnlyRow(plan, rows)
  if (row === undefined) {
    return toMissingResult(plan)
  }
  try {
    return decodeFlatRow(plan, fields, columns, width, row)
  } catch (error) {
    throw toFieldError("", error)
  }
}

/** Returns `count`, the number of the rows of the command tag of a statement, rejecting it as a query of one row in the rows mode of `plan` rejects its rows. */
function decodeCount(plan: ResultMode, count: number): number {
  if (plan.rows !== "many") {
    // The command tag counts the rows that the statement changes or returns, whichever its command is.
    if (count > 1) {
      throw new Error(`Query of one row reported ${count} rows`)
    }
    if (count === 0 && plan.rows === "one") {
      throw new NotFoundError("Query reported no rows")
    }
  }
  return count
}

/** Indexes of the only result column, of the value of a flat plan. */
const onlyColumn: readonly number[] = /* @__PURE__ */ Object.freeze([0])

/** Returns the indexes of the result columns of `fields` among `columns`, in the order of the fields, rejecting a missing column and one that the result has twice, and another number of columns than one for a value. */
function findColumns(
  plan: ResultMode,
  fields: readonly FlatField[],
  columns: readonly string[],
): readonly number[] {
  if (plan.value) {
    if (columns.length !== 1) {
      throw new ResultDecodeError(
        `Statement returned ${columns.length} columns for one value`,
        undefined,
      )
    }
    return onlyColumn
  }
  const indexes: number[] = []
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
  }
  return indexes
}

/** Failure to decode the value of a field of a row, which the result turns into its error once it adds the index of the row. */
class FieldFailure extends Error {
  constructor(
    readonly key: string,
    override readonly cause: unknown,
  ) {
    super()
  }
}

/**
 * Decodes a row of the driver into a record of the values of the result columns of `columns`, or into the value of its only column, rejecting with a `FieldFailure` of the field whose value fails.
 *
 * It rejects a row of another width than `width`, the number of the result columns, with the error of the result.
 */
function decodeFlatRow(
  plan: ResultMode,
  fields: readonly FlatField[],
  columns: readonly number[],
  width: number,
  row: readonly TextValue[],
): unknown {
  if (row.length !== width) {
    throw new ResultDecodeError(
      `Driver returned a row of ${row.length} values for ${width} columns`,
      undefined,
    )
  }
  // One try per row rather than per value; the index tells which field failed.
  let index = 0
  try {
    if (plan.value) {
      return decodeFlatValue(fields[0]!.codec, row[columns[0]!])
    }
    const record: Record<string, unknown> = {}
    for (; index < fields.length; index++) {
      const field = fields[index]!
      record[field.key] = decodeFlatValue(field.codec, row[columns[index]!])
    }
    return record
  } catch (error) {
    throw new FieldFailure(fields[index]!.key, error)
  }
}

/** Decodes a value of a row of the driver with `codec`, keeping `NULL` as `null`, and rejecting a missing value, such as of a sparse row. */
function decodeFlatValue(codec: AnyCodec, value: TextValue | undefined): unknown {
  if (value === undefined) {
    throw new Error("Driver returned no value")
  }
  return value === null ? null : codec.decode(value)
}

/** Returns the error of the result of a `FieldFailure`, adding `prefix`, such as the index of the row, before the key of its field. */
function toFieldError(prefix: string, error: unknown): unknown {
  return error instanceof FieldFailure
    ? createFieldDecodeError(prefix + error.key, error.cause)
    : error
}
