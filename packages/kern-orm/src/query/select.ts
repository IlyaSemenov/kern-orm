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
import type { EqValue, WhereFilter } from "./filters"
import { addUserFilter } from "./filters"
import type { KeyCheck, PrimaryKeyValues } from "./find"
import { toKeyValues, toPrimaryKeyValues } from "./find"
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

/** Query of state `S`, bound or unbound. */
export type QueryOf<S extends SelectQueryState> = SelectQuery<S, SelectQueryKind>

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

/** Changes of the node of a query, which a method collects before it derives a query from them. */
type NodeChanges = { -readonly [K in keyof QueryNode]?: QueryNode[K] }

/**
 * Immutable select query of state `S`, unbound or bound to a `Db`.
 *
 * Every method returns a query of the same kind and leaves this query unchanged.
 * An unbound query is not thenable, so it can be returned from async functions; it is compiled with `toSQL` or executed by a `Db`.
 * A bound query executes on its `Db` when awaited.
 */
// Methods take the query they are called on from `this` rather than from the parameters of the class, so that the parameters reach only members that keep the query covariant in them, as `out` declares and TypeScript checks.
// So a query of a narrower state or kind is a query of a wider one, and comparing two queries of different states compares their states rather than their methods.
// - The methods that keep the state in types, such as `where`, and `use`, which returns the query of its callback, take the whole query as `Q`, so that they also apply to a union of queries.
// - A method that changes the state takes the state and the kind of the query as its own `S` and `Kind`; TypeScript infers one state from a union of queries of different states, which the other queries do not fit.
export class SelectQuery<
  out S extends SelectQueryState,
  out Kind extends SelectQueryKind = "unbound",
> {
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
    this.db = db as QueryDb<Kind>
    // oxlint-disable-next-line unicorn/no-thenable -- only a bound query gets a function
    this.then = (db === undefined ? undefined : executeOnAwait) as QueryThen<S, Kind>
    Object.freeze(this)
  }

  /** Adds a filter combined with `AND` with the previous ones. */
  where<Q extends AnySelectQuery>(this: Q, filter: WhereFilter<Q["types"]["table"]>): Q
  where(filter: WhereFilter<AnyTable>): unknown {
    return this.derive({ filters: addUserFilter(this.node.filters, filter, this.node.from) })
  }

  /** Selects all columns of the table, replacing fields under their keys. */
  select<S extends RecordQueryState, Kind extends SelectQueryKind>(
    this: SelectQuery<S, Kind>,
    all: "*",
  ): SelectQuery<
    ChangeState<S, { result: MergeSelection<S["result"], Selectable<S["table"]>> }>,
    Kind
  >
  /** Selects the listed columns, replacing fields under their keys. */
  select<
    S extends RecordQueryState,
    Kind extends SelectQueryKind,
    K extends keyof S["table"]["columns"] & string,
  >(
    this: SelectQuery<S, Kind>,
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
  select<S extends RecordQueryState, Kind extends SelectQueryKind, Sel extends Selection>(
    this: SelectQuery<S, Kind>,
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
  clearSelect<S extends RecordQueryState, Kind extends SelectQueryKind>(
    this: SelectQuery<S, Kind>,
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
  take<S extends SelectQueryState, Kind extends SelectQueryKind>(
    this: SelectQuery<S, Kind>,
  ): SelectQuery<ChangeState<S, { rows: OneRow<S["rows"]> }>, Kind>
  take(): unknown {
    return this.deriveTaken({})
  }

  /**
   * Filters the query by the values of the primary key of the table, in the order of its columns, and limits it to one row, as `where` followed by `take`.
   *
   * A value is what `where` takes for its column, such as an expression, but never `null` or `undefined`.
   * Without a row, it rejects with `NotFoundError` unless `optional` or `nullable` makes the query resolve to `undefined` or `null`.
   */
  find<S extends SelectQueryState, Kind extends SelectQueryKind>(
    this: SelectQuery<S, Kind>,
    ...values: PrimaryKeyValues<S["table"]>
  ): SelectQuery<ChangeState<S, { rows: OneRow<S["rows"]> }>, Kind>
  find(...values: readonly unknown[]): unknown {
    return this.takeWhere(toPrimaryKeyValues(this.table, values))
  }

  /**
   * Filters the query by the values of the columns of one key of the table, primary or unique, and limits it to one row, as `where` followed by `take`.
   *
   * A value is what `where` takes for its column, such as an expression, but never `null` or `undefined`.
   * Without a row, it rejects with `NotFoundError` unless `optional` or `nullable` makes the query resolve to `undefined` or `null`.
   */
  findBy<
    S extends SelectQueryState,
    Kind extends SelectQueryKind,
    K extends keyof S["table"]["columns"] & string,
  >(
    this: SelectQuery<S, Kind>,
    // A mapped type rather than an alias, so that errors show the columns and their values rather than the table.
    values: { readonly [C in K]: NonNullable<EqValue<S["table"], C>> } & KeyCheck<S["table"], K>,
  ): SelectQuery<ChangeState<S, { rows: OneRow<S["rows"]> }>, Kind>
  findBy(values: unknown): unknown {
    return this.takeWhere(toKeyValues(this.table, values))
  }

  /**
   * Replaces the selected fields with a column, limits the query to one row, and returns the value of the column instead of a record.
   *
   * Without a row, it rejects with `NotFoundError`, or resolves to `undefined` when the query is optional or nullable; a `NULL` value is `null`.
   */
  get<
    S extends SelectQueryState,
    Kind extends SelectQueryKind,
    K extends keyof S["table"]["columns"] & string,
  >(
    this: SelectQuery<S, Kind>,
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
   * Without a row, it rejects with `NotFoundError`, or resolves to `undefined` when the query is optional or nullable; a `NULL` value is `null`.
   */
  get<S extends SelectQueryState, Kind extends SelectQueryKind, E extends TypedExpression>(
    this: SelectQuery<S, Kind>,
    callback: (columns: ColumnRefs<S["table"]>) => E,
  ): SelectQuery<
    ChangeState<S, { result: ExpressionValue<E>; rows: OneValueRows<S["rows"]>; value: true }>,
    Kind
  >
  get(arg: unknown): unknown {
    // The changes of `pluck` followed by `take`.
    return this.deriveTaken({
      projections: [projectValue(this.node.from, arg, "get")],
      value: true,
      rows: toValueRows(this.node.rows),
    })
  }

  /**
   * Replaces the selected fields with a column and returns the value of the column of each row instead of a record.
   *
   * It keeps whether the query returns an array or one value, such as after `take`, and how it handles a missing row, except that a nullable query resolves to `undefined` without a row.
   */
  pluck<
    S extends SelectQueryState,
    Kind extends SelectQueryKind,
    K extends keyof S["table"]["columns"] & string,
  >(
    this: SelectQuery<S, Kind>,
    key: K,
  ): SelectQuery<
    ChangeState<S, { result: Selectable<S["table"]>[K]; rows: ValueRows<S["rows"]>; value: true }>,
    Kind
  >
  /**
   * Replaces the selected fields with the expression returned by `callback` and returns the value of the expression for each row instead of a record.
   *
   * It keeps whether the query returns an array or one value, such as after `take`, and how it handles a missing row, except that a nullable query resolves to `undefined` without a row.
   */
  pluck<S extends SelectQueryState, Kind extends SelectQueryKind, E extends TypedExpression>(
    this: SelectQuery<S, Kind>,
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
  orderBy<Q extends QueryOf<RecordQueryState>>(
    this: Q,
    callback: (
      columns: ColumnRefs<Q["types"]["table"]>,
      selected: SelectedRefs<Q["types"]["result"]>,
    ) => OrderTerms,
  ): Q
  /**
   * Sorts the values of a query made by `get` or `pluck` by the sort keys returned by `callback`, after the sort keys of earlier calls.
   *
   * `callback` receives the columns and the expression of the value, and returns an expression, sorted in ascending order, `asc`, `desc`, or `orderBy` of an expression, or an array of them.
   */
  orderBy<Q extends QueryOf<ValueQueryState>>(
    this: Q,
    callback: (
      columns: ColumnRefs<Q["types"]["table"]>,
      value: AnyExpression<Q["types"]["result"]>,
    ) => OrderTerms,
  ): Q
  /** Sorts the rows by the listed columns in ascending order, or in the directions of objects of columns, after the sort keys of earlier calls. */
  orderBy<Q extends AnySelectQuery>(this: Q, ...keys: OrderKey<Q["types"]["table"]>[]): Q
  orderBy(...args: unknown[]): unknown {
    return this.derive({ orderBy: addOrder(this.node, args) })
  }

  /** Returns at most `count` rows of a query of many rows, replacing an earlier limit. */
  limit<Q extends QueryOf<ManyRowsQueryState>>(this: Q, count: number): Q
  limit(count: number): unknown {
    return this.derive({ limit: this.createCount("limit", count) })
  }

  /** Skips the first `count` rows of a query of many rows, replacing an earlier offset. */
  offset<Q extends QueryOf<ManyRowsQueryState>>(this: Q, count: number): Q
  offset(count: number): unknown {
    return this.derive({ offset: this.createCount("offset", count) })
  }

  /** Makes a query of one row, such as one of `take` or `get`, resolve to `undefined` without a row. */
  optional<S extends OneRowQueryState, Kind extends SelectQueryKind>(
    this: SelectQuery<S, Kind>,
  ): SelectQuery<ChangeState<S, { rows: "optional" }>, Kind>
  optional(): unknown {
    return this.changeOneRow("optional", "optional")
  }

  /**
   * Makes a query of one record, such as one of `take`, resolve to `null` without a row.
   *
   * A value of `get` or `pluck` is never `null` for a missing row, which would read as a `NULL` value, so a query of values does not accept it, and after `get` or `pluck` the query resolves to `undefined` without a row.
   */
  nullable<S extends OneRecordQueryState, Kind extends SelectQueryKind>(
    this: SelectQuery<S, Kind>,
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
  required<S extends OneRowQueryState, Kind extends SelectQueryKind>(
    this: SelectQuery<S, Kind>,
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
  use<
    Q,
    Kind extends SelectQueryKind,
    // oxlint-disable-next-line typescript/no-explicit-any -- a query of any state of this kind
    R extends SelectQuery<any, Kind>,
    A extends unknown[] = [],
  >(
    // The whole query, so that the callback receives a union of queries as it is, and its kind.
    // oxlint-disable-next-line typescript/no-explicit-any -- the kind of a query of any state
    this: Q & SelectQuery<any, Kind>,
    callback: (query: Q, ...args: A) => R,
    ...args: A
  ): R
  use(
    callback: (query: AnySelectQuery, ...args: unknown[]) => unknown,
    ...args: unknown[]
  ): unknown {
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
  private derive(changes: Partial<QueryNode>): AnySelectQuery {
    return new SelectQuery(
      this.table,
      Object.freeze({ ...this.node, ...changes }),
      this.context,
      this.db as AnyDb | undefined,
    )
  }

  /**
   * Creates a query of the same kind and `Db` with the node changes applied and then those of `take`, in one derived query.
   *
   * It adds the changes of `take` to `changes`, which must leave the limit as it is.
   */
  private deriveTaken(changes: NodeChanges): AnySelectQuery {
    if ((changes.rows ?? this.node.rows) === "many") {
      changes.limit = limitToOne(this.node.limit)
      changes.rows = "one"
    }
    return this.derive(changes)
  }

  /** Creates the query of `find` and `findBy`: `where` of `values`, an object of column values, followed by `take`. */
  private takeWhere(values: Record<string, unknown>): AnySelectQuery {
    return this.deriveTaken({ filters: addUserFilter(this.node.filters, values, this.node.from) })
  }

  /** Creates the query of one row with rows mode `rows` that `method` returns, rejecting a query of many rows. */
  private changeOneRow(method: string, rows: ResultRows): AnySelectQuery {
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
  | QueryOf<QueryStateOf<T, C>>

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
