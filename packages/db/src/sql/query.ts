// Queries of SQL text: a statement that resolves to the number of the rows of its command tag or to the fields of its rows decoded by types.

import type { SqlStatement, StatementExecutor } from "../driver"
import type {
  FlatField,
  FlatResultPlan,
  OneRow,
  OneValueRows,
  ResultByRows,
  ResultRows,
  ValueRows,
} from "../result"
import { decodeFlatResult, isRecordKey, toValueRows } from "../result"
import type { AnyType, TypeOutput, typeValues } from "../type/type"
import { isType } from "../type/type"

import type { AnySqlColumns } from "./columns"
import { SqlColumns } from "./columns"
import { addComment, createComment } from "./comment"
import type { SqlValue } from "./fragment"
import { compileFragment, sql } from "./fragment"

/** Compiles the statement of a query of SQL text, each time the query executes or compiles, so that what it reads when it compiles, such as a PostgreSQL schema of the current tenant, is current. */
export type StatementSource = () => SqlStatement

/**
 * Fields of the rows of a query of SQL text by their keys: a type, which decodes the result column named by the key, or the columns of a record, which make a record of their own from their result columns.
 */
export interface FieldTypes {
  readonly [key: string]: AnyType | AnySqlColumns
  readonly [key: symbol]: never
}

// Columns declare their record as a type declares its values, so that one lookup reads both without a conditional type for each field.
/** Record of the values that the types of fields `F` decode, and of the records of their columns. */
export type DecodedFields<F extends FieldTypes> = {
  -readonly [K in keyof F]: F[K][typeof typeValues]["output"]
}

/**
 * State in types of a query of SQL text: its result, which is the number of the rows of its command tag until a selection returns their fields, how its rows become its result, and the rows mode of the rows that its statement returns.
 *
 * Methods change only their own parts of the state.
 */
export interface SqlQueryState {
  /** Record of a row, the value of its only column for a query of `get` or `pluck`, or the number of the rows. */
  readonly result: unknown
  /** How the rows become the result. */
  readonly rows: ResultRows
  /** Whether a row is the value of its only column instead of a record. */
  readonly value: boolean
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
  readonly returned: "many"
  readonly returning: false
}

/** Result of a query of SQL text of state `S`. */
export type SqlQueryResult<S extends SqlQueryState> = ResultByRows<S["result"], S["rows"]>

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
  : Record<never, never>

/** Record of fields `P` with the fields of `N` added, replacing the fields of their keys. */
type MergeFields<P, N> = {
  [K in keyof P | keyof N]: K extends keyof N ? N[K] : K extends keyof P ? P[K] : never
}

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

/** Result plan of a query of SQL text that resolves to the number of the rows of its command tag. */
const countPlan: FlatResultPlan = /* @__PURE__ */ Object.freeze({
  fields: undefined,
  rows: "many",
  value: false,
})

/**
 * Immutable query of a statement of SQL text, which executes on its executor, such as a database, when awaited.
 *
 * Without a selection, it resolves to the number of the rows of the command tag of its statement, such as the rows that an `UPDATE` changes; `select`, `get`, and `pluck` return the fields of the rows of the statement instead, decoded by types.
 */
// It holds the source of its statement apart from the plan of its result and its comment, so that the methods that change them share the statement, which compiles each time the query executes.
export class SqlQuery<out S extends SqlQueryState> {
  declare readonly types: S

  constructor(
    /** Compiles the statement of the query. */
    private readonly source: StatementSource,
    /** Executes the statement. */
    private readonly executor: StatementExecutor,
    /** How the result of the statement is decoded. */
    private readonly plan: FlatResultPlan,
    /** Label of `comment`, which the text of the statement starts with. */
    private readonly label?: string,
  ) {
    Object.freeze(this)
  }

  /** Executes the query on its executor. */
  // oxlint-disable-next-line unicorn/no-thenable -- awaiting a query executes it
  then<R1 = SqlQueryResult<S>, R2 = never>(
    onFulfilled?: ((result: SqlQueryResult<S>) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return (this.execute() as Promise<SqlQueryResult<S>>).then(onFulfilled, onRejected)
  }

  /**
   * Returns the records of the rows of the statement instead of their number, with the fields of `fields` under their keys; it adds the fields to those selected earlier, replacing fields under their keys.
   *
   * A field of a type, such as `id: t.integer`, is the value of the result column of its key, `id`, decoded by the type.
   * A field of the columns of a record, such as `claimed: job` of `columnsOf` of kern-orm, is a record under its key, `claimed`, read from the result columns that the columns name, such as `j__id`, or `null` without its row for columns of `nullable`.
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
        result: MergeFields<ReturnedRecord<S>, DecodedFields<F>>
        rows: S["returned"]
        value: false
        returning: true
      }
    >
  >
  select(fields: FieldTypes): unknown {
    const { plan } = this
    if (plan.fields !== undefined && plan.value) {
      throw new Error(
        "select cannot be used after get or pluck; call get or pluck to replace the value",
      )
    }
    if (typeof fields !== "object" || fields === null) {
      throw new TypeError(
        "select takes an object of fields by their keys: types of values, or columns of records",
      )
    }
    // `Object.keys` would skip a symbol key and a key that is not enumerable, leaving a field that the result type promises.
    const added = Reflect.ownKeys(fields)
    const selected: FlatField[] = []
    let hasGroups = false
    for (const field of plan.fields ?? []) {
      // A group is replaced as a whole under its key.
      if (!added.includes(field.group?.key ?? field.key)) {
        selected.push(field)
        hasGroups ||= field.group !== undefined
      }
    }
    for (const key of added) {
      if (typeof key === "symbol") {
        throw new TypeError("A selected field must have a string key")
      }
      if (!isRecordKey(key)) {
        throw new Error(`Field "${key}" cannot be a key of a record`)
      }
      const field: unknown = fields[key]
      if (field instanceof SqlColumns) {
        hasGroups = true
        const group = Object.freeze({ key, size: field.fields.length, presence: field.presence })
        for (const column of field.fields) {
          selected.push(
            Object.freeze({ key: column.key, name: column.column, type: column.type, group }),
          )
        }
      } else if (isType(field)) {
        selected.push(Object.freeze({ key, name: key, type: field, group: undefined }))
      } else {
        throw new TypeError(`field "${key}" takes a type or the columns of a record`)
      }
    }
    if (hasGroups) {
      rejectSharedColumns(selected)
    }
    return this.derive({ fields: selected, rows: plan.rows, value: false })
  }

  /**
   * Returns the value of the only column of the row of the statement instead of the number of the rows, decoded by `type`.
   *
   * Without a row, it rejects with `NotFoundError` unless `optional` makes the query resolve to `undefined`; it rejects several rows.
   * A `NULL` value is `null`, or the value that `type` decodes `NULL` to, so a type of a column that can be `NULL` must be nullable.
   * With a type that decodes `NULL` to `undefined`, `optional` does not tell a missing row from `NULL`, which a record of `select` tells.
   */
  get<S extends SqlQueryState, C extends AnyType>(
    this: SqlQuery<S>,
    type: C,
  ): SqlQuery<ValueState<S, TypeOutput<C>, OneValueRows<S["returned"]>>>
  get(type: AnyType): unknown {
    const { rows } = this.plan
    return this.deriveValue(type, "get", rows === "many" ? "one" : toValueRows(rows))
  }

  /**
   * Returns the values of the only column of the rows of the statement instead of their number, decoded by `type`, keeping whether the query returns an array or one value.
   *
   * A `NULL` value is `null`, or the value that `type` decodes `NULL` to, so a type of a column that can be `NULL` must be nullable.
   */
  pluck<S extends SqlQueryState, C extends AnyType>(
    this: SqlQuery<S>,
    type: C,
  ): SqlQuery<ValueState<S, TypeOutput<C>, ValueRows<S["returned"]>>>
  pluck(type: AnyType): unknown {
    return this.deriveValue(type, "pluck", toValueRows(this.plan.rows))
  }

  /**
   * Returns the row of the statement instead of an array, and rejects with `NotFoundError` without it and with several rows; it adds no limit to the statement.
   *
   * Before a selection, the query resolves to the number of the rows, `1`, and rejects as well.
   */
  take<S extends SqlQueryState>(this: SqlQuery<S>): SqlQuery<RowsState<S, OneRow<S["returned"]>>>
  take(): unknown {
    const { rows } = this.plan
    return this.deriveRows(rows === "many" ? "one" : rows)
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
    const { plan } = this
    if (plan.fields !== undefined && plan.value) {
      throw new Error(
        "nullable applies only to a query of records; use optional after get or pluck",
      )
    }
    return this.changeOneRow("nullable")
  }

  /**
   * Starts the SQL of the statement of the query with `label` in a block comment, such as to find the statement in `pg_stat_activity` and in the log of PostgreSQL.
   *
   * It replaces an earlier comment of the query, and `null` removes it; the queries derived from it, such as of `select` and `take`, keep it.
   * It rejects a label that contains the start or the end of a block comment, or a NUL character.
   */
  comment(label: string | null): SqlQuery<S> {
    return new SqlQuery(this.source, this.executor, this.plan, createComment(label))
  }

  /** Compiles the query into SQL text and parameters, as it executes. */
  toSQL(): SqlStatement {
    return this.compile()
  }

  /** Compiles the statement, executes it on the executor, and decodes its result by the plan. */
  // An async function, so that a statement that fails to compile rejects the promise.
  private async execute(): Promise<unknown> {
    const statement = this.compile()
    return decodeFlatResult(this.plan, await this.executor.execute(statement))
  }

  /** Compiles the statement with the source, starting its text with the comment of the query, if any. */
  private compile(): SqlStatement {
    const statement = this.source()
    const { label } = this
    if (label === undefined) {
      return statement
    }
    // A spread keeps the fields that a builder adds to its statement, such as the values of `getNativeParameters` of the postgres.js driver.
    return { ...statement, text: addComment(statement.text, label) }
  }

  /** Creates the query of the same statement and comment with result plan `plan`. */
  private derive(plan: FlatResultPlan): AnySqlQuery {
    return new SqlQuery(this.source, this.executor, Object.freeze(plan), this.label)
  }

  /** Creates the query of the same fields in rows mode `rows`. */
  private deriveRows(rows: ResultRows): AnySqlQuery {
    const { plan } = this
    return this.derive({ fields: plan.fields, rows, value: plan.value })
  }

  /** Creates the query that returns the value of the only column of each row in rows mode `rows`, decoded by `type` of `method`. */
  private deriveValue(type: unknown, method: string, rows: ResultRows): AnySqlQuery {
    // The key names no record field: it only names the value in decoding errors.
    const field = Object.freeze({
      key: "value",
      name: "value",
      type: requireType(type, method),
      group: undefined,
    })
    return this.derive({ fields: [field], rows, value: true })
  }

  /** Creates the query of one row in rows mode `rows`, rejecting a query of many rows. */
  private changeOneRow(rows: "optional" | "nullable"): AnySqlQuery {
    if (this.plan.rows === "many") {
      throw new Error(`${rows} applies only to a query of one row, such as one made by take`)
    }
    return this.deriveRows(rows)
  }
}

/** Query of SQL text of any state. */
// oxlint-disable-next-line typescript/no-explicit-any -- any query of SQL text regardless of its result
export type AnySqlQuery = SqlQuery<any>

/**
 * Starts the query that compiles its statement with `source` and executes it on `executor`, such as a database, when awaited.
 *
 * The query resolves to the number of the rows of the command tag of its statement.
 */
export function startSqlQuery(
  source: StatementSource,
  executor: StatementExecutor,
): SqlQuery<InitialSqlQueryState> {
  return new SqlQuery(source, executor, countPlan)
}

/**
 * Returns the template that starts a query of a SQL statement on `executor`, such as a `Driver`, a `Connection`, or an object with `execute` of its own, as `query` of a `Database` starts it on the database: `` queryOn(connection)`SELECT 1` ``.
 *
 * The statement runs where `execute` of the executor runs it: a `Database` runs it in its ambient transaction or session, a driver on any pooled connection, and a connection on itself, in the transaction that is open on it, if any.
 * A call of `execute` of a driver or a connection bypasses the routing of a database over them, and an object of the application runs the statement wherever its `execute` passes it, such as in the routing of a database for one that calls `execute` of the database.
 */
export function queryOn(
  executor: StatementExecutor,
): (strings: TemplateStringsArray, ...values: SqlValue[]) => SqlQuery<InitialSqlQueryState> {
  // A template called without an executor, such as queryOn`SELECT 1`, passes its strings here.
  if (typeof (executor as Partial<StatementExecutor> | null | undefined)?.execute !== "function") {
    throw new TypeError(
      "queryOn() takes an object with an execute method, such as a database, a driver, or a connection, and returns the template of a statement: queryOn(executor)`SELECT 1`",
    )
  }
  return (strings, ...values) => {
    // The template rejects a value that it does not take when the query is created, so that the error points at the template.
    const fragment = sql(strings, ...values)
    return startSqlQuery(() => compileFragment(fragment), executor)
  }
}

/** Returns `value` that `what` takes as its type, rejecting a value that is not a type. */
function requireType(value: unknown, what: string): AnyType {
  if (!isType(value)) {
    throw new TypeError(`${what} takes a type`)
  }
  return value
}

/**
 * Rejects fields of a selection that read one result column, such as the columns of two records without prefixes that have a column of one key each, or of prefixes `a` and `a_` with keys `_b` and `b`: the statement cannot return a column of that name for each.
 *
 * Only the columns of a record name a result column apart from the key of a field, so a selection without them needs no check.
 */
function rejectSharedColumns(fields: readonly FlatField[]): void {
  const paths = new Map<string, string>()
  for (const field of fields) {
    const path = field.group === undefined ? field.key : `${field.group.key}.${field.key}`
    const other = paths.get(field.name)
    if (other !== undefined) {
      throw new Error(
        `Fields "${other}" and "${path}" read one result column "${field.name}"; give the columns of records prefixes that make the names of their result columns differ`,
      )
    }
    paths.set(field.name, path)
  }
}
