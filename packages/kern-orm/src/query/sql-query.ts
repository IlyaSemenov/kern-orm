// Queries of SQL text: a statement of `$query`, which resolves to the number of the rows of its command tag or to the fields of its rows decoded by types.

import type { RawSqlNode, TextStatementNode } from "../ast/nodes"
import type { AnyDb } from "../execution/db"
import type { SqlStatement } from "../execution/driver"
import type { ResultRows, ScalarField } from "../result/result"
import { isRecordKey } from "../result/result"
import type { AnyType, TypeOutput } from "../type/type"
import { isType } from "../type/type"

import type { QueryThen } from "./kind"
import { executeOnAwait } from "./kind"
import type { OneRow, OneValueRows, ValueRows } from "./rows"
import { toValueRows } from "./rows"
import type { MergeSelection } from "./selection"
import type { EmptyRecord, QueryState } from "./state"

/** Types of the fields of the rows of a query of SQL text by the names of the result columns they decode. */
export interface FieldTypes {
  readonly [key: string]: AnyType
  readonly [key: symbol]: never
}

/** Record of the values that the types of fields `F` decode. */
export type DecodedFields<F extends FieldTypes> = { -readonly [K in keyof F]: TypeOutput<F[K]> }

/**
 * State in types of a query of SQL text: the rows mode of the rows that its statement returns, and its result, which is the number of the rows of its command tag until a selection returns their fields.
 *
 * Methods change only their own parts of the state.
 */
export interface SqlQueryState extends QueryState {
  /** Rows mode of the rows of the statement, which `select`, `get`, and `pluck` return. */
  readonly returned: ResultRows
  /** Whether the query returns the fields of the rows of the statement rather than their number. */
  readonly returning: boolean
}

/** State of a query of SQL text that returns the number of the rows of its command tag. */
export interface InitialSqlQueryState extends SqlQueryState {
  readonly result: number
  readonly rows: "one"
  readonly value: true
  readonly uses: never
  readonly returned: "many"
  readonly returning: false
}

/** State `S` of a query of SQL text with the parts of `Changes` replaced. */
type ChangeSqlQueryState<S extends SqlQueryState, Changes extends Partial<SqlQueryState>> = {
  readonly [K in keyof SqlQueryState]: K extends keyof Changes ? Changes[K] : S[K]
} & {}

/** State of a query of SQL text that returns the number of the rows or their records, which `select` applies to. */
type RecordSqlQueryState = SqlQueryState &
  ({ readonly returning: false } | { readonly value: false })

/** State of a query of SQL text of one row, which `optional` applies to. */
type OneRowSqlQueryState = SqlQueryState & { readonly returned: "one" | "nullable" | "optional" }

/** State of a query of SQL text of one row that returns its number or its record, which `nullable` applies to. */
type OneRecordSqlQueryState = OneRowSqlQueryState & RecordSqlQueryState

/** Record that the fields of a query of SQL text of state `S` add to: the fields selected earlier, or none. */
type ReturnedRecord<S extends SqlQueryState> = S["returning"] extends true
  ? S["result"]
  : EmptyRecord

/** State of a query of SQL text of state `S` whose rows are in rows mode `Rows`. */
type RowsState<S extends SqlQueryState, Rows extends ResultRows> = ChangeSqlQueryState<
  S,
  { returned: Rows; rows: S["returning"] extends true ? Rows : "one" }
>

/** State of a query of SQL text of state `S` that returns value `V` of each row in rows mode `Rows`. */
type ValueState<S extends SqlQueryState, V, Rows extends ResultRows> = ChangeSqlQueryState<
  S,
  { result: V; rows: Rows; returned: Rows; value: true; returning: true }
>

/**
 * Immutable query of a statement of SQL text, bound to the `Db` that executes it when awaited.
 *
 * Without a selection, it resolves to the number of the rows of the command tag of its statement, such as the rows that an `UPDATE` changes; `select`, `get`, and `pluck` return the fields of the rows of the statement instead, decoded by types.
 */
// Like `SelectQuery`, it is covariant in its state, so that a `Db` executes it whatever its state.
export class SqlQuery<out S extends SqlQueryState> {
  declare readonly types: S
  /** Executes the query on its `Db`. */
  // oxlint-disable-next-line unicorn/no-thenable -- awaiting a query executes it
  readonly then: QueryThen<S, "bound">

  constructor(
    readonly node: TextStatementNode,
    /** `Db` that executes the query when it is awaited. */
    readonly db: AnyDb,
  ) {
    // oxlint-disable-next-line unicorn/no-thenable -- awaiting a query executes it
    this.then = executeOnAwait as QueryThen<S, "bound">
    Object.freeze(this)
  }

  /**
   * Returns the records of the rows of the statement instead of their number, with the values of the result columns named by the keys of `fields`, decoded by their types; it adds the fields to those selected earlier, replacing fields under their keys.
   *
   * A type of a column that can be `NULL` must be nullable.
   * The statement rejects without a column of a field, or with the column twice; other columns are ignored.
   */
  select<S extends RecordSqlQueryState, F extends FieldTypes>(
    this: SqlQuery<S>,
    fields: F,
  ): SqlQuery<
    ChangeSqlQueryState<
      S,
      {
        result: MergeSelection<ReturnedRecord<S>, DecodedFields<F>>
        rows: S["returned"]
        value: false
        returning: true
      }
    >
  >
  select(fields: FieldTypes): unknown {
    const { node } = this
    if (node.fields !== undefined && node.value) {
      throw new Error(
        "select cannot be used after get or pluck; call get or pluck to replace the value",
      )
    }
    if (typeof fields !== "object" || fields === null) {
      throw new TypeError("select takes an object of the types of the fields by their columns")
    }
    // `Object.keys` would skip a symbol key and a key that is not enumerable, leaving a field that the result type promises.
    const added = Reflect.ownKeys(fields)
    const selected: ScalarField[] = []
    for (const field of node.fields ?? []) {
      if (!added.includes(field.key)) {
        selected.push(field)
      }
    }
    for (const key of added) {
      if (typeof key === "symbol") {
        throw new TypeError("A selected field must have a string key")
      }
      if (!isRecordKey(key)) {
        throw new Error(`Field "${key}" cannot be a key of a record`)
      }
      selected.push(Object.freeze({ key, type: requireType(fields[key], `field "${key}"`) }))
    }
    return this.derive({ fields: selected, value: false })
  }

  /**
   * Returns the value of the only column of the row of the statement instead of the number of the rows, decoded by `type`.
   *
   * Without a row, it rejects with `NotFoundError` unless `optional` makes the query resolve to `undefined`; it rejects several rows.
   * A `NULL` value is `null`, so a type of a column that can be `NULL` must be nullable.
   */
  get<S extends SqlQueryState, T extends AnyType>(
    this: SqlQuery<S>,
    type: T,
  ): SqlQuery<ValueState<S, TypeOutput<T>, OneValueRows<S["returned"]>>>
  get(type: AnyType): unknown {
    const { rows } = this.node
    return this.deriveValue(type, "get", rows === "many" ? "one" : toValueRows(rows))
  }

  /**
   * Returns the values of the only column of the rows of the statement instead of their number, decoded by `type`, keeping whether the query returns an array or one value.
   *
   * A `NULL` value is `null`, so a type of a column that can be `NULL` must be nullable.
   */
  pluck<S extends SqlQueryState, T extends AnyType>(
    this: SqlQuery<S>,
    type: T,
  ): SqlQuery<ValueState<S, TypeOutput<T>, ValueRows<S["returned"]>>>
  pluck(type: AnyType): unknown {
    return this.deriveValue(type, "pluck", toValueRows(this.node.rows))
  }

  /**
   * Returns the row of the statement instead of an array, and rejects with `NotFoundError` without it and with several rows; it adds no limit to the statement.
   *
   * Before a selection, the query resolves to the number of the rows, `1`, and rejects as well.
   */
  take<S extends SqlQueryState>(this: SqlQuery<S>): SqlQuery<RowsState<S, OneRow<S["returned"]>>>
  take(): unknown {
    const { rows } = this.node
    return this.derive({ rows: rows === "many" ? "one" : rows })
  }

  /**
   * Makes a query of one row, such as one of `take` or `get`, resolve to `undefined` without the row.
   *
   * Before a selection, the query resolves to `0` without the row.
   */
  optional<S extends OneRowSqlQueryState>(this: SqlQuery<S>): SqlQuery<RowsState<S, "optional">>
  optional(): unknown {
    return this.changeOneRow("optional")
  }

  /**
   * Makes a query of one record, such as one of `take`, resolve to `null` without the row.
   *
   * A value of `get` or `pluck` is never `null` for a missing row, which would read as a `NULL` value, so a query of values does not accept it.
   * Before a selection, the query resolves to `0` without the row.
   */
  nullable<S extends OneRecordSqlQueryState>(this: SqlQuery<S>): SqlQuery<RowsState<S, "nullable">>
  nullable(): unknown {
    const { node } = this
    if (node.fields !== undefined && node.value) {
      throw new Error(
        "nullable applies only to a query of records; use optional after get or pluck",
      )
    }
    return this.changeOneRow("nullable")
  }

  /** Compiles the query into SQL text and parameters, as its `Db` executes it. */
  toSQL(): SqlStatement {
    return this.db.$compile(this)
  }

  /** Creates a query of the same `Db` with the node changes applied. */
  private derive(changes: Partial<TextStatementNode>): AnySqlQuery {
    return new SqlQuery(Object.freeze({ ...this.node, ...changes }), this.db)
  }

  /** Creates the query that returns the value of the only column of each row in rows mode `rows`, decoded by `type` of `method`. */
  private deriveValue(type: unknown, method: string, rows: ResultRows): AnySqlQuery {
    // The key names no record field: it only names the value in decoding errors.
    const field = Object.freeze({ key: "value", type: requireType(type, method) })
    return this.derive({ fields: [field], value: true, rows })
  }

  /** Creates the query of one row in rows mode `rows`, rejecting a query of many rows. */
  private changeOneRow(rows: "optional" | "nullable"): AnySqlQuery {
    if (this.node.rows === "many") {
      throw new Error(`${rows} applies only to a query of one row, such as one made by take`)
    }
    return this.derive({ rows })
  }
}

/** Query of SQL text of any state. */
// oxlint-disable-next-line typescript/no-explicit-any -- any query of SQL text regardless of its result
export type AnySqlQuery = SqlQuery<any>

/** Starts the query of the statement of `sql` bound to `db`, which resolves to the number of the rows of its command tag. */
export function startSqlQuery(sql: RawSqlNode, db: AnyDb): SqlQuery<InitialSqlQueryState> {
  return new SqlQuery(
    Object.freeze({ kind: "text", sql, fields: undefined, rows: "many", value: false }),
    db,
  )
}

/** Returns `value` that `what` takes as its type, rejecting a value that is not a type, such as a column. */
function requireType(value: unknown, what: string): AnyType {
  if (!isType(value)) {
    throw new TypeError(`${what} takes a type, such as t.integer, not a column or another value`)
  }
  return value
}
