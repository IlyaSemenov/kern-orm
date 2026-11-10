// Queries of SQL text: a statement that resolves to the number of the rows of its command tag or to the fields of its rows decoded by codecs.

import type { AnyCodec, CodecOutput } from "../codec/codec"
import { isCodec } from "../codec/codec"
import type { Database } from "../database"
import type { SqlStatement } from "../driver"
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

/** Compiles the statement of a query of SQL text, each time the query executes or compiles, so that what it reads when it compiles, such as a PostgreSQL schema of the current tenant, is current. */
export type StatementSource = () => SqlStatement

/** Codecs of the fields of the rows of a query of SQL text by the names of the result columns that they decode. */
export interface FieldCodecs {
  readonly [key: string]: AnyCodec
  readonly [key: symbol]: never
}

/** Record of the values that the codecs of fields `F` decode. */
export type DecodedFields<F extends FieldCodecs> = { -readonly [K in keyof F]: CodecOutput<F[K]> }

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
 * Immutable query of a statement of SQL text, which executes on its database when awaited.
 *
 * Without a selection, it resolves to the number of the rows of the command tag of its statement, such as the rows that an `UPDATE` changes; `select`, `get`, and `pluck` return the fields of the rows of the statement instead, decoded by codecs.
 */
// It holds the source of its statement apart from the plan of its result, so that the methods that change the result share the statement, which compiles each time the query executes.
export class SqlQuery<out S extends SqlQueryState> {
  declare readonly types: S

  constructor(
    /** Compiles the statement of the query. */
    private readonly source: StatementSource,
    /** Database that executes the statement. */
    private readonly database: Pick<Database, "execute">,
    /** How the result of the statement is decoded. */
    private readonly plan: FlatResultPlan,
  ) {
    Object.freeze(this)
  }

  /** Executes the query on its database. */
  // oxlint-disable-next-line unicorn/no-thenable -- awaiting a query executes it
  then<R1 = SqlQueryResult<S>, R2 = never>(
    onFulfilled?: ((result: SqlQueryResult<S>) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return (this.execute() as Promise<SqlQueryResult<S>>).then(onFulfilled, onRejected)
  }

  /**
   * Returns the records of the rows of the statement instead of their number, with the values of the result columns named by the keys of `fields`, decoded by their codecs; it adds the fields to those selected earlier, replacing fields under their keys.
   *
   * A codec of a column that can be `NULL` must be nullable.
   * The statement rejects without a column of a field, or with the column twice; other columns are ignored.
   */
  select<S extends RecordSqlQueryState, F extends FieldCodecs>(
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
  select(fields: FieldCodecs): unknown {
    const { plan } = this
    if (plan.fields !== undefined && plan.value) {
      throw new Error(
        "select cannot be used after get or pluck; call get or pluck to replace the value",
      )
    }
    if (typeof fields !== "object" || fields === null) {
      throw new TypeError("select takes an object of the codecs of the fields by their columns")
    }
    // `Object.keys` would skip a symbol key and a key that is not enumerable, leaving a field that the result type promises.
    const added = Reflect.ownKeys(fields)
    const selected: FlatField[] = []
    for (const field of plan.fields ?? []) {
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
      selected.push(Object.freeze({ key, codec: requireCodec(fields[key], `field "${key}"`) }))
    }
    return this.derive({ fields: selected, rows: plan.rows, value: false })
  }

  /**
   * Returns the value of the only column of the row of the statement instead of the number of the rows, decoded by `codec`.
   *
   * Without a row, it rejects with `NotFoundError` unless `optional` makes the query resolve to `undefined`; it rejects several rows.
   * A `NULL` value is `null`, so a codec of a column that can be `NULL` must be nullable.
   */
  get<S extends SqlQueryState, C extends AnyCodec>(
    this: SqlQuery<S>,
    codec: C,
  ): SqlQuery<ValueState<S, CodecOutput<C>, OneValueRows<S["returned"]>>>
  get(codec: AnyCodec): unknown {
    const { rows } = this.plan
    return this.deriveValue(codec, "get", rows === "many" ? "one" : toValueRows(rows))
  }

  /**
   * Returns the values of the only column of the rows of the statement instead of their number, decoded by `codec`, keeping whether the query returns an array or one value.
   *
   * A `NULL` value is `null`, so a codec of a column that can be `NULL` must be nullable.
   */
  pluck<S extends SqlQueryState, C extends AnyCodec>(
    this: SqlQuery<S>,
    codec: C,
  ): SqlQuery<ValueState<S, CodecOutput<C>, ValueRows<S["returned"]>>>
  pluck(codec: AnyCodec): unknown {
    return this.deriveValue(codec, "pluck", toValueRows(this.plan.rows))
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

  /** Compiles the query into SQL text and parameters, as it executes. */
  toSQL(): SqlStatement {
    return this.source()
  }

  /** Compiles the statement, executes it on the database, and decodes its result by the plan. */
  // An async function, so that a statement that fails to compile rejects the promise.
  private async execute(): Promise<unknown> {
    const statement = this.source()
    return decodeFlatResult(this.plan, await this.database.execute(statement))
  }

  /** Creates the query of the same statement with result plan `plan`. */
  private derive(plan: FlatResultPlan): AnySqlQuery {
    return new SqlQuery(this.source, this.database, Object.freeze(plan))
  }

  /** Creates the query of the same fields in rows mode `rows`. */
  private deriveRows(rows: ResultRows): AnySqlQuery {
    const { plan } = this
    return this.derive({ fields: plan.fields, rows, value: plan.value })
  }

  /** Creates the query that returns the value of the only column of each row in rows mode `rows`, decoded by `codec` of `method`. */
  private deriveValue(codec: unknown, method: string, rows: ResultRows): AnySqlQuery {
    // The key names no record field: it only names the value in decoding errors.
    const field = Object.freeze({ key: "value", codec: requireCodec(codec, method) })
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

/** Starts the query of the statement that `source` compiles, executed on `database`, which resolves to the number of the rows of its command tag. */
export function startSqlQuery(
  source: StatementSource,
  database: Pick<Database, "execute">,
): SqlQuery<InitialSqlQueryState> {
  return new SqlQuery(source, database, countPlan)
}

/** Returns `value` that `what` takes as its codec, rejecting a value that is not a codec. */
function requireCodec(value: unknown, what: string): AnyCodec {
  if (!isCodec(value)) {
    throw new TypeError(`${what} takes a codec`)
  }
  return value
}
