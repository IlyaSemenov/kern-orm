// Results of statements: how rows modes make the rows of a statement its result, the keys that a decoded record can have, the errors of a result that breaks its contract, and the decoding of flat results, whose rows hold no nested rows.

import type { DriverColumn, DriverResult, TextValue } from "./driver"
import { quoteIdentifier } from "./identifier"
import type { AnyType } from "./type/type"

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

/** Field of a flat result: the key of its value in its record, the name of the result column of the value, and the type that decodes the value. */
export interface FlatField {
  readonly key: string
  /** Name of the result column: the key of a field of the record of a row, and a name of its own for a field of a group. */
  readonly name: string
  readonly type: AnyType
  /** Group whose record holds the field instead of the record of the row; the fields of a group follow each other. */
  readonly group?: FlatGroup | undefined
}

/** Group of fields of a flat result: a record nested in the record of a row under a key, read from result columns of its own, such as of the columns of a joined table. */
export interface FlatGroup {
  /** Key of the record of the group in the record of the row. */
  readonly key: string
  /** Number of the fields of the group. */
  readonly size: number
  /**
   * Positions among the fields of the group of those that tell whether the statement has a row of the record, such as of a primary key: the record is `null` when all of them are `NULL`, such as without a match of an outer join.
   *
   * `undefined` for a group whose record is never `null`.
   */
  readonly presence: readonly number[] | undefined
}

/** How a flat result decodes the result of a statement. */
export interface FlatResultPlan extends ResultMode {
  /**
   * Fields read from the result columns of their names, or from the only column for a value, whatever its name; `undefined` for a result that is the number of the rows of the command tag.
   *
   * The key of the field of a value names it only in decoding errors, and its name is not read.
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

/**
 * Creates the error of a result that fails to decode or to convert, with the failure `cause` as its cause, whose message follows `message`.
 *
 * `path` is the path of the failing value, as `ResultDecodeError` describes it.
 */
export function createResultDecodeError(
  message: string,
  path: string | undefined,
  cause: unknown,
): ResultDecodeError {
  // Only an Error contributes its message: converting another thrown value to a string can throw itself.
  const detail = cause instanceof Error ? `: ${cause.message}` : ""
  return new ResultDecodeError(message + detail, path, { cause })
}

/** Creates the error of a value at `path` of a result that fails to decode, such as `[2].label`, with the failure as its cause. */
export function createFieldDecodeError(path: string, cause: unknown): ResultDecodeError {
  return createResultDecodeError(`Cannot decode result field "${path}"`, path, cause)
}

/**
 * Decodes the result of a statement by a flat plan: its rows, or the number of the rows of its command tag for a plan without fields.
 *
 * Fields are read from the result columns of their names rather than by position, since the statement chooses the order of its columns: a missing column, a column that the result has twice, and another number of columns than one for a value reject with `ResultDecodeError`, and the other columns of records are ignored.
 * The fields of a group make a record of their own under the key of the group, or `null` when the result columns that tell its row are all `NULL`; some of them `NULL` reject.
 * A row of the driver of another width than the result columns rejects too, rather than reading a missing value as `NULL`.
 * A number of rows of a query of one row rejects as its rows do, with `NotFoundError` without a row unless it is optional or nullable, and with several rows.
 */
export function decodeFlatResult(plan: FlatResultPlan, result: DriverResult): unknown {
  const { fields } = plan
  if (fields === undefined) {
    return decodeCount(plan, result.count)
  }
  // Resolve names once per result; every row below reads its values by the resulting positions.
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
  columns: readonly DriverColumn[],
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
  // Keep up to four scans, or fewer than 256 comparisons, free of Map allocation; wider selections use an indexed pass.
  // The cutoff and the trade-off against a full-column Map are measured in decisions/sql-queries/result-column-lookup.md.
  const byName =
    fields.length > 4 && fields.length * columns.length >= 256
      ? indexSelectedColumns(fields, columns)
      : undefined
  const indexes: number[] = []
  for (const { name } of fields) {
    let column = -1
    if (byName) {
      column = byName.get(name)!
    } else {
      // A match is not enough: a later column can make the requested name ambiguous.
      for (let candidate = 0; candidate < columns.length; candidate++) {
        if (columns[candidate]!.name === name) {
          if (column !== -1) {
            column = -2
            break
          }
          column = candidate
        }
      }
    }
    if (column === -1) {
      throw new ResultDecodeError(`Statement returned no column "${name}"`, undefined)
    }
    if (column === -2) {
      throw new ResultDecodeError(`Statement returned column "${name}" more than once`, undefined)
    }
    indexes.push(column)
  }
  return indexes
}

/**
 * Indexes only requested names, marking missing columns with -1 and duplicate names with -2.
 *
 * It records ambiguity without throwing, so the caller reports the first invalid field in selection order and ignores duplicate unselected columns.
 */
function indexSelectedColumns(
  fields: readonly FlatField[],
  columns: readonly DriverColumn[],
): Map<string, number> {
  const byName = new Map<string, number>()
  for (const { name } of fields) byName.set(name, -1)
  for (let index = 0; index < columns.length; index++) {
    const name = columns[index]!.name
    const column = byName.get(name)
    if (column !== undefined) byName.set(name, column === -1 ? index : -2)
  }
  return byName
}

/** Failure to decode the value of a field of a row, which the result turns into its error once it adds the index of the row. */
class FieldFailure extends Error {
  constructor(
    /** Path of the field from the record of the row, such as `label` or `job.id`. */
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
      return decodeFlatValue(fields[0]!.type, row[columns[0]!])
    }
    const record: Record<string, unknown> = {}
    while (index < fields.length) {
      const field = fields[index]!
      const { group } = field
      if (group === undefined) {
        record[field.key] = decodeFlatValue(field.type, row[columns[index]!])
        index++
      } else {
        record[group.key] = decodeFlatGroup(group, fields, columns, row, index)
        index += group.size
      }
    }
    return record
  } catch (error) {
    // A group names its own field.
    throw error instanceof FieldFailure ? error : new FieldFailure(fields[index]!.key, error)
  }
}

/**
 * Returns the failure of a row of `group` with only some of the result columns that tell a missing row `NULL`, naming those that are `NULL` and those that are not.
 *
 * A column without a value, such as of a sparse row, fails as a field whose value the driver did not return, since it is neither `NULL` nor a value.
 */
function createPartialPresenceFailure(
  group: FlatGroup,
  fields: readonly FlatField[],
  row: readonly TextValue[],
  columns: readonly number[],
  start: number,
): FieldFailure {
  let nulls = ""
  let values = ""
  for (const position of group.presence!) {
    const field = fields[start + position]!
    const value = row[columns[start + position]!]
    if (value === undefined) {
      return new FieldFailure(`${group.key}.${field.key}`, new Error("Driver returned no value"))
    }
    // Quoted, so that a name with a quote or a comma reads as one column.
    const name = quoteIdentifier(field.name)
    if (value === null) {
      nulls += nulls === "" ? name : `, ${name}`
    } else {
      values += values === "" ? name : `, ${name}`
    }
  }
  return new FieldFailure(
    group.key,
    new Error(
      `Expected the result columns that tell a missing row to be all NULL or all not NULL; NULL: ${nulls}; not NULL: ${values}`,
    ),
  )
}

/**
 * Decodes the record of `group`, whose fields start at `start` of `fields`, from a row of the driver, or returns `null` when the result columns that tell its row are all `NULL`, without decoding the others.
 *
 * It rejects with a `FieldFailure` of the field whose value fails, or of the group when only some of those columns are `NULL`.
 */
function decodeFlatGroup(
  group: FlatGroup,
  fields: readonly FlatField[],
  columns: readonly number[],
  row: readonly TextValue[],
  start: number,
): Record<string, unknown> | null {
  const { presence } = group
  if (presence !== undefined) {
    let missing = 0
    for (let index = 0; index < presence.length; index++) {
      if (row[columns[start + presence[index]!]!] === null) {
        missing++
      }
    }
    if (missing === presence.length) {
      return null
    }
    if (missing !== 0) {
      // Columns that are never NULL in a row of the record, so the result is not of the statement that the group describes.
      throw createPartialPresenceFailure(group, fields, row, columns, start)
    }
  }
  // One try per group rather than per value; the offset tells which field failed.
  let offset = 0
  try {
    const record: Record<string, unknown> = {}
    for (; offset < group.size; offset++) {
      const field = fields[start + offset]!
      record[field.key] = decodeFlatValue(field.type, row[columns[start + offset]!])
    }
    return record
  } catch (error) {
    throw new FieldFailure(`${group.key}.${fields[start + offset]!.key}`, error)
  }
}

/** Decodes a value of a row of the driver with `type`, keeping `NULL` as `null`, and rejecting a missing value, such as of a sparse row. */
function decodeFlatValue(type: AnyType, value: TextValue | undefined): unknown {
  if (value === undefined) {
    throw new Error("Driver returned no value")
  }
  return value === null ? null : type.decode(value)
}

/** Returns the error of the result of a `FieldFailure`, adding `prefix`, such as the index of the row, before the key of its field. */
function toFieldError(prefix: string, error: unknown): unknown {
  return error instanceof FieldFailure
    ? createFieldDecodeError(prefix + error.key, error.cause)
    : error
}
