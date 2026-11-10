// Results of statements: how rows modes make the rows of a statement its result, the keys that a decoded record can have, and the errors of a result that breaks its contract.

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
