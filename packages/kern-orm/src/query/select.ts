import type { ExpressionNode } from "../ast/nodes"
import { createNode } from "../ast/nodes"
import type { CompileOptions } from "../compiler/postgres/compile"
import { compileSelect } from "../compiler/postgres/compile"
import type { AnyDb } from "../execution/db"
import type { SqlStatement } from "../execution/driver"
import { createStatement } from "../execution/driver"
import type { AnyExpression, TypedExpression } from "../expression/expression"
import { lowerStatement } from "../lowering/lower"
import type { ResultMode, ResultRows } from "../result/result"
import type { NoRelations, SchemaContext, UsedRelation } from "../schema/relation"
import type { AnyTable, Selectable } from "../table/table"

import type { ColumnRefs, QueryContext, RelationRefs } from "./column-refs"
import { noContext } from "./column-refs"
import type { WhereFilter } from "./filters"
import { addUserFilter } from "./filters"
import type { QueryDb, QueryThen, SelectQueryKind, ToSQLArgs } from "./kind"
import { executeOnAwait } from "./kind"
import type { QueryNode } from "./node"
import { createQueryNode } from "./node"
import type { OrderKey, OrderTerms, SelectedRefs } from "./order"
import { addOrder } from "./order"
import { mergeProjections, projectValue } from "./projections"
import type { OneRow, OneValueRows, ValueRows } from "./rows"
import { limitToOne, toValueRows } from "./rows"
import type {
  ExpressionValue,
  MergeSelection,
  Selection,
  SelectionResult,
  SelectionUses,
} from "./selection"

/** Records of a query without selected fields. */
export type EmptyRecord = Record<never, never>

/**
 * State of a select query in types: its table, the relations of its schema, the record or value of its rows, how its rows become its result, and the relations it selects records of.
 *
 * Methods change only their own parts of the state.
 */
export interface SelectQueryState extends ResultMode {
  readonly table: AnyTable
  readonly schema: SchemaContext
  /** Record of a row, or the value of its only field for a query made by `get` or `pluck`. */
  readonly result: unknown
  /** Relations whose records the query and the queries nested in it select, which a `Db` must have. */
  readonly uses: UsedRelation
}

// An interface rather than an intersection lets a call infer `T` and `C` from a query.
/** State of a query over table `T` with schema context `C`, whatever its result. */
export interface QueryStateOf<
  T extends AnyTable,
  C extends SchemaContext = SchemaContext,
> extends SelectQueryState {
  readonly table: T
  readonly schema: C
}

/**
 * State of a query that starts from table `T` with schema context `C`: rows as records without fields, all of them or of the records of relation `U` when given, in rows mode `Rows`.
 *
 * Without relations in `C`, it also types a query of the table in a schema that has relations of the table.
 */
export interface InitialQueryState<
  T extends AnyTable,
  C extends SchemaContext = NoRelations,
  U extends UsedRelation = never,
  Rows extends ResultRows = "many",
> extends QueryStateOf<T, C> {
  readonly result: EmptyRecord
  readonly rows: Rows
  readonly value: false
  readonly uses: U
}

// Declared in the module of `SelectQuery`: declared in another module, it makes TypeScript 6 and `bun check` reject queries passed to `$execute` and `$compile` of a `Db`.
/** State `S` with the parts of `Changes` replaced. */
export type ChangeState<S extends SelectQueryState, Changes extends Partial<SelectQueryState>> = {
  readonly [K in keyof SelectQueryState]: K extends keyof Changes ? Changes[K] : S[K]
} & {}

// Methods constrain `this` as the same query with `types` of one of these states rather than as a query of that state, which TypeScript would compare with the query member by member.
/** State of a query whose rows are records, which `select` and `clearSelect` change. */
type RecordQueryState = SelectQueryState & { readonly value: false }

/** State of a query whose rows are values, made by `get` or `pluck`. */
type ValueQueryState = SelectQueryState & { readonly value: true }

/** State of a query of many rows, which `limit` and `offset` apply to. */
type ManyRowsQueryState = SelectQueryState & { readonly rows: "many" }

/** State of a query of one row, which `optional` and `required` apply to. */
type OneRowQueryState = SelectQueryState & { readonly rows: "one" | "nullable" | "optional" }

/** State of a query of one row whose rows are records, which `nullable` applies to. */
type OneRecordQueryState = OneRowQueryState & { readonly value: false }

// TypeScript can fall back to comparing every method when the states of two `SelectQuery` types differ.
// `QueryOfState` limits the comparison to the state and the inherited mark.
/** Select query of either kind whose state is assignable to `S`. */
export interface QueryOfState<S extends SelectQueryState> extends MarkedQuery {
  readonly types: S
}

/** Base class of `SelectQuery`, whose protected mark only queries have, so that `QueryOfState` accepts only them; a copy of a query made by spread or rest lacks the mark. */
abstract class MarkedQuery {
  declare protected readonly mark: true
}

/**
 * Immutable select query of state `S`, unbound or bound to a `Db`.
 *
 * Every method returns a query of the same kind and leaves this query unchanged.
 * An unbound query is not thenable, so it can be returned from async functions; it is compiled with `toSQL` or executed by a `Db`.
 * A bound query executes on its `Db` when awaited.
 */
export class SelectQuery<
  S extends SelectQueryState,
  Kind extends SelectQueryKind = "unbound",
> extends MarkedQuery {
  declare readonly types: S
  /** `Db` that executes the query when it is awaited; `undefined` for an unbound query. */
  readonly db: QueryDb<Kind>
  /** Executes a bound query on its `Db`; `undefined` for an unbound query, so that it is not thenable. */
  // oxlint-disable-next-line unicorn/no-thenable -- awaiting a bound query executes it; unbound queries are not thenable
  readonly then: QueryThen<S, Kind>

  constructor(
    readonly table: S["table"],
    readonly node: QueryNode,
    /** Relations of the table in the schema the query starts from, which `select` gives its callback. */
    readonly context: QueryContext,
    db?: AnyDb,
  ) {
    super()
    this.db = db as QueryDb<Kind>
    // oxlint-disable-next-line unicorn/no-thenable -- only a bound query gets a function
    this.then = (db === undefined ? undefined : executeOnAwait) as QueryThen<S, Kind>
    Object.freeze(this)
  }

  /** Adds a filter combined with `AND` with the previous ones. */
  where(filter: WhereFilter<S["table"]>): SelectQuery<S, Kind> {
    return this.derive({ filters: addUserFilter(this.node.filters, filter, this.node.from) })
  }

  /** Selects all columns of the table, replacing fields under their keys. */
  select(
    this: SelectQuery<S, Kind> & { readonly types: RecordQueryState },
    all: "*",
  ): SelectQuery<
    ChangeState<S, { result: MergeSelection<S["result"], Selectable<S["table"]>> }>,
    Kind
  >
  /** Selects the listed columns, replacing fields under their keys. */
  select<K extends keyof S["table"]["columns"] & string>(
    this: SelectQuery<S, Kind> & { readonly types: RecordQueryState },
    ...keys: K[]
  ): SelectQuery<
    ChangeState<S, { result: MergeSelection<S["result"], Pick<Selectable<S["table"]>, K>> }>,
    Kind
  >
  /**
   * Selects the expressions and nested queries returned by `callback`, replacing fields under their keys.
   *
   * `callback` receives the columns and the queries of the relations of the table.
   * Each expression is decoded with its type, so it must have one: a column, an operator result, or a fragment of `sql(type)`, but not of `sql<T>`.
   * A nested query is unbound, such as a query of a relation, or bound to the `Db` that runs the query; its rows become the value of its field as they become the result of an executed query.
   */
  select<Sel extends Selection>(
    this: SelectQuery<S, Kind> & { readonly types: RecordQueryState },
    // An intersection rather than one alias of both, so that queries of one table compare the same column references.
    callback: (columns: ColumnRefs<S["table"]> & RelationRefs<S["schema"]>) => Sel,
  ): SelectQuery<
    ChangeState<
      S,
      {
        result: MergeSelection<S["result"], SelectionResult<Sel>>
        uses: S["uses"] | SelectionUses<Sel>
      }
    >,
    Kind
  >
  select(...args: unknown[]): unknown {
    this.rejectValue("select")
    return this.derive({
      projections: mergeProjections(this.node.projections, this.node.from, args, this.context),
    })
  }

  /** Removes all selected fields and keeps the other clauses. */
  clearSelect(
    this: SelectQuery<S, Kind> & { readonly types: RecordQueryState },
  ): SelectQuery<ChangeState<S, { result: EmptyRecord }>, Kind>
  clearSelect(): unknown {
    this.rejectValue("clearSelect")
    return this.derive({ projections: [] })
  }

  /**
   * Limits the query to one row and returns the row instead of an array; without a row, it rejects with `NotFoundError` unless `optional` or `nullable` makes the query resolve to `undefined` or `null`.
   *
   * A query of one row stays as it is.
   */
  take(): SelectQuery<ChangeState<S, { rows: OneRow<S["rows"]> }>, Kind> {
    return this.derive(
      this.node.rows === "many" ? { limit: limitToOne(this.node.limit), rows: "one" } : {},
    )
  }

  /**
   * Replaces the selected fields with a column, limits the query to one row, and returns the value of the column instead of a record.
   *
   * Without a row, it rejects with `NotFoundError` unless the query is optional; a `NULL` value is `null`.
   * Calling `get` directly after `nullable` makes the query reject without a row.
   */
  get<K extends keyof S["table"]["columns"] & string>(
    key: K,
  ): SelectQuery<
    ChangeState<
      S,
      { result: Selectable<S["table"]>[K]; rows: OneValueRows<S["rows"]>; value: true }
    >,
    Kind
  >
  /**
   * Replaces the selected fields with the expression returned by `callback`, limits the query to one row, and returns the value of the expression instead of a record.
   *
   * Without a row, it rejects with `NotFoundError` unless the query is optional; a `NULL` value is `null`.
   * Calling `get` directly after `nullable` makes the query reject without a row.
   */
  get<E extends TypedExpression>(
    callback: (columns: ColumnRefs<S["table"]>) => E,
  ): SelectQuery<
    ChangeState<S, { result: ExpressionValue<E>; rows: OneValueRows<S["rows"]>; value: true }>,
    Kind
  >
  get(arg: unknown): unknown {
    const projections = [projectValue(this.node.from, arg, "get")]
    // The same changes as `pluck` followed by `take`, in one derived query.
    const { rows } = this.node
    return this.derive(
      rows === "many"
        ? { projections, value: true, limit: limitToOne(this.node.limit), rows: "one" }
        : { projections, value: true, rows: toValueRows(rows) },
    )
  }

  /**
   * Replaces the selected fields with a column and returns the value of the column of each row instead of a record.
   *
   * It keeps whether the query returns an array or one value, such as after `take`, and how it handles a missing row, except that a query made by `nullable` rejects without a row.
   */
  pluck<K extends keyof S["table"]["columns"] & string>(
    key: K,
  ): SelectQuery<
    ChangeState<S, { result: Selectable<S["table"]>[K]; rows: ValueRows<S["rows"]>; value: true }>,
    Kind
  >
  /**
   * Replaces the selected fields with the expression returned by `callback` and returns the value of the expression for each row instead of a record.
   *
   * It keeps whether the query returns an array or one value, such as after `take`, and how it handles a missing row, except that a query made by `nullable` rejects without a row.
   */
  pluck<E extends TypedExpression>(
    callback: (columns: ColumnRefs<S["table"]>) => E,
  ): SelectQuery<
    ChangeState<S, { result: ExpressionValue<E>; rows: ValueRows<S["rows"]>; value: true }>,
    Kind
  >
  pluck(arg: unknown): unknown {
    return this.derive({
      projections: [projectValue(this.node.from, arg, "pluck")],
      value: true,
      rows: toValueRows(this.node.rows),
    })
  }

  /**
   * Sorts the rows by the sort keys returned by `callback`, after the sort keys of earlier calls.
   *
   * `callback` receives the columns and the fields selected so far, and returns an expression, sorted in ascending order, `asc`, `desc`, or `orderBy` of an expression, or an array of them.
   * A selected field sorts by the value of the field, also when it changes from row to row, such as `random()`.
   */
  orderBy(
    this: SelectQuery<S, Kind> & { readonly types: RecordQueryState },
    callback: (columns: ColumnRefs<S["table"]>, selected: SelectedRefs<S["result"]>) => OrderTerms,
  ): SelectQuery<S, Kind>
  /**
   * Sorts the values of a query made by `get` or `pluck` by the sort keys returned by `callback`, after the sort keys of earlier calls.
   *
   * `callback` receives the columns and the expression of the value, and returns an expression, sorted in ascending order, `asc`, `desc`, or `orderBy` of an expression, or an array of them.
   */
  orderBy(
    this: SelectQuery<S, Kind> & { readonly types: ValueQueryState },
    callback: (columns: ColumnRefs<S["table"]>, value: AnyExpression<S["result"]>) => OrderTerms,
  ): SelectQuery<S, Kind>
  /** Sorts the rows by the listed columns in ascending order, or in the directions of objects of columns, after the sort keys of earlier calls. */
  orderBy(...keys: OrderKey<S["table"]>[]): SelectQuery<S, Kind>
  orderBy(...args: unknown[]): SelectQuery<S, Kind> {
    return this.derive({ orderBy: addOrder(this.node, args) })
  }

  /** Returns at most `count` rows of a query of many rows, replacing an earlier limit. */
  limit(
    this: SelectQuery<S, Kind> & { readonly types: ManyRowsQueryState },
    count: number,
  ): SelectQuery<S, Kind>
  limit(count: number): unknown {
    return this.derive({ limit: this.createCount("limit", count) })
  }

  /** Skips the first `count` rows of a query of many rows, replacing an earlier offset. */
  offset(
    this: SelectQuery<S, Kind> & { readonly types: ManyRowsQueryState },
    count: number,
  ): SelectQuery<S, Kind>
  offset(count: number): unknown {
    return this.derive({ offset: this.createCount("offset", count) })
  }

  /** Makes a query of one row, such as one of `take` or `get`, resolve to `undefined` without a row. */
  optional(
    this: SelectQuery<S, Kind> & { readonly types: OneRowQueryState },
  ): SelectQuery<ChangeState<S, { rows: "optional" }>, Kind>
  optional(): unknown {
    return this.changeOneRow("optional", "optional")
  }

  /**
   * Makes a query of one record, such as one of `take`, resolve to `null` without a row.
   *
   * A value of `get` or `pluck` is never `null` for a missing row, which would read as a `NULL` value, so a query of values does not accept it, and `get` and `pluck` make the query reject without a row.
   */
  nullable(
    this: SelectQuery<S, Kind> & { readonly types: OneRecordQueryState },
  ): SelectQuery<ChangeState<S, { rows: "nullable" }>, Kind>
  nullable(): unknown {
    if (this.node.value) {
      throw new Error(
        "nullable applies only to a query of records; use optional after get or pluck",
      )
    }
    return this.changeOneRow("nullable", "nullable")
  }

  /** Makes a query of one row, such as one of `optional` or `nullable`, reject without a row. */
  required(
    this: SelectQuery<S, Kind> & { readonly types: OneRowQueryState },
  ): SelectQuery<ChangeState<S, { rows: "one" }>, Kind>
  required(): unknown {
    return this.changeOneRow("required", "one")
  }

  // The result is constrained to the kind of this query, so a callback cannot change the binding, and a Promise or another value is rejected.
  // A state of `any` spares comparing the state of every result with `SelectQueryState` member by member.
  /**
   * Returns the query that `callback` builds from this query, such as one with a conditional clause, or that a helper of `defineHelper` builds with `args`.
   *
   * `callback` receives this query and `args` and returns this query or a query derived from it, which keeps the binding of this query.
   */
  // oxlint-disable-next-line typescript/no-explicit-any -- a query of any state of this kind
  use<R extends SelectQuery<any, Kind>, A extends unknown[] = []>(
    callback: (query: SelectQuery<S, Kind>, ...args: A) => R,
    ...args: A
  ): R {
    return requireDerived(this, callback(this, ...args), "The callback of use")
  }

  /**
   * Compiles the query into SQL text and parameters; `schemaName` qualifies its tables.
   *
   * A query bound to a `Db` compiles as the `Db` executes it, with the PostgreSQL schema of the `Db`, and rejects options.
   */
  toSQL(...args: ToSQLArgs<Kind>): SqlStatement
  toSQL(options?: CompileOptions): SqlStatement {
    const db = this.db as AnyDb | undefined
    if (db === undefined) {
      const { text, parameters } = compileSelect(lowerStatement(this.node), options)
      return createStatement(text, parameters)
    }
    // A caller holding the query as a query of either kind can still pass options, which the `Db` would not apply.
    if (options !== undefined) {
      throw new Error("A query bound to a Db compiles with the options of its Db")
    }
    return db.$compile(this)
  }

  /** Creates a query of the same kind and `Db` with the node changes applied. */
  protected derive<R extends SelectQueryState = S>(
    changes: Partial<QueryNode>,
  ): SelectQuery<R, Kind> {
    return new SelectQuery<R, Kind>(
      this.table,
      Object.freeze({ ...this.node, ...changes }),
      this.context,
      this.db as AnyDb | undefined,
    )
  }

  /** Creates the query of one row with rows mode `rows` that `method` returns, rejecting a query of many rows. */
  private changeOneRow(method: string, rows: ResultRows): unknown {
    if (this.node.rows === "many") {
      throw new Error(`${method} applies only to a query of one row, such as one made by take`)
    }
    return this.derive({ rows })
  }

  // A query of one row has no pagination, which would hide a second row that it must reject.
  /** Creates the parameter of the number of rows of `limit` or `offset`, named by `method`, rejecting a query of one row. */
  private createCount(method: "limit" | "offset", count: number): ExpressionNode {
    if (this.node.rows !== "many") {
      // A query of a relation `one` has one row from its start.
      const hint = this.node.relation?.kind === "one" ? "" : "; call it before take or get"
      throw new Error(`${method} applies only to a query of many rows${hint}`)
    }
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new RangeError(`${method} takes a non-negative integer, not ${count}`)
    }
    return createNode({ kind: "param", value: count, type: undefined })
  }

  /** Rejects a change of the selection of a query made by `get` or `pluck`. */
  private rejectValue(method: string): void {
    if (this.node.value) {
      throw new Error(
        `${method} cannot be used after get or pluck; call one of them again to replace the value`,
      )
    }
  }
}

/** Select query bound to a `Db`, executed by awaiting it; every method returns a query bound to the same `Db`. */
export type BoundSelectQuery<S extends SelectQueryState> = SelectQuery<S, "bound">

/**
 * Returns `result`, which a callback named by `subject` returned for `query`, after checking that it is `query` or a query derived from it.
 *
 * An ancestor of `query` also passes, since only the source occurrence is compared.
 */
export function requireDerived<R>(query: AnySelectQuery, result: R, subject: string): R {
  // A query derived from `query` keeps its source occurrence and its `Db`.
  if (!(result instanceof SelectQuery) || result.node.from !== query.node.from) {
    throw new Error(`${subject} must return the query it receives or one derived from it`)
  }
  return result
}

/** Select query of any state and kind. */
// oxlint-disable-next-line typescript/no-explicit-any -- any select query regardless of its result
export type AnySelectQuery = SelectQuery<any, SelectQueryKind>

/** Type of a record of a query result, or of its value for a query made by `get` or `pluck`. */
export type ResultOf<Q extends AnySelectQuery> = Q["types"]["result"]

/** Binds a query to `db`, so that awaiting it executes it there. */
export function bindQuery<S extends SelectQueryState>(
  query: SelectQuery<S>,
  db: AnyDb,
): BoundSelectQuery<S> {
  return new SelectQuery<S, "bound">(query.table, query.node, query.context, db)
}

/** Table of a definition such as `defineFilter`: the table itself or a query over it with schema context `C`, such as `schema.form`. */
export type TableOrQuery<T extends AnyTable, C extends SchemaContext = SchemaContext> =
  | T
  | QueryOfState<QueryStateOf<T, C>>

/** Starts a query over a new occurrence of the table. */
export function from<T extends AnyTable>(table: T): SelectQuery<InitialQueryState<T>> {
  return startQuery(table, noContext)
}

/** Starts a query over a new occurrence of the table with the relations of `context`, such as a query of a table of a schema. */
export function startQuery<S extends SelectQueryState>(
  table: S["table"],
  context: QueryContext,
): SelectQuery<S> {
  return new SelectQuery(table, createQueryNode(Object.freeze({ kind: "table", table })), context)
}
