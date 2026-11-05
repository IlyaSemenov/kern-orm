// Mutations of a table: inserts, updates, and deletes, which return the number of the rows they change or the fields of those rows.

import { combineFilters } from "../ast/boolean"
import type { CompileOptions } from "../compiler/postgres/compile"
import type { AnyDb } from "../execution/db"
import type { SqlStatement } from "../execution/driver"
import { operandNode } from "../expression/expression"
import type { TypedOperand } from "../expression/functions"
import type { OperandValue } from "../expression/operators/comparison"
import type { ResultRows } from "../result/result"
import type { SchemaContext, UsedRelation } from "../schema/relation"
import type { AnyTable, Selectable } from "../table/table"

import type { ColumnRefs, QueryContext, RelationRefs } from "./column-refs"
import type { QueryDb, QueryThen, SelectQueryKind, ToSQLArgs } from "./kind"
import { compileToSQL, executeOnAwait } from "./kind"
import type { MutationNode, QueryNode } from "./node"
import { isTableQuery } from "./node"
import { mergeProjections, projectValue } from "./projections"
import type { OneValueRows, ValueRows } from "./rows"
import { toValueRows } from "./rows"
import type { AnySelectQuery, OperandUses } from "./select"
import type { MergeSelection, Selection, SelectionResult, SelectionUses } from "./selection"
import type { EmptyRecord, QueryState } from "./state"
import { toAssignments, toInsertRows } from "./values"

/**
 * State in types of a query that inserts, updates, or deletes rows: its table and the relations of its schema, the rows mode of the rows it changes, and its result, which is their number until a selection returns their fields.
 *
 * Methods change only their own parts of the state.
 */
export interface MutationQueryState extends QueryState {
  readonly table: AnyTable
  readonly schema: SchemaContext
  /** Rows mode of the rows that the query changes, which `select`, `get`, and `pluck` return. */
  readonly changed: ResultRows
  /** Whether the query returns the fields of the rows it changes rather than their number. */
  readonly returning: boolean
}

/** State of a query that inserts, updates, or deletes rows of table `T` with schema context `C` in rows mode `Rows` and returns their number, whose values select records of relations `U`. */
export interface InitialMutationState<
  T extends AnyTable,
  C extends SchemaContext,
  Rows extends ResultRows,
  U extends UsedRelation = never,
> extends MutationQueryState {
  readonly table: T
  readonly schema: C
  readonly changed: Rows
  readonly returning: false
  readonly result: number
  readonly rows: "one"
  readonly value: true
  readonly uses: U
}

// Apart from `ChangeState` of `select.ts`: a parameter of `ChangeState` for the parts of the state made each change of a select query cost more instantiations, such as 40% more for a helper, and an alias of the mapped type shared by both made methods reject a union of queries that differ by their fields, such as `cond ? query.select("id", "title") : query.select("id")`.
/** State `S` of a mutation with the parts of `Changes` replaced. */
type ChangeMutationState<
  S extends MutationQueryState,
  Changes extends Partial<MutationQueryState>,
> = {
  readonly [K in keyof MutationQueryState]: K extends keyof Changes ? Changes[K] : S[K]
} & {}

/** State of a mutation that returns the number of the rows it changes or their records, which `select` applies to. */
type RecordMutationState = MutationQueryState &
  ({ readonly returning: false } | { readonly value: false })

/** State of a mutation of one row, which `get` applies to. */
type OneRowMutationState = MutationQueryState & {
  readonly changed: "one" | "nullable" | "optional"
}

/** Record that the returned fields of a mutation of state `S` add to: the fields selected earlier, or none. */
type ReturnedRecord<S extends MutationQueryState> = S["returning"] extends true
  ? S["result"]
  : EmptyRecord

/** State of a mutation of state `S` that returns records with `Fields`, which its nested queries select records of relations `U` for. */
type RecordsState<
  S extends MutationQueryState,
  Fields,
  U extends UsedRelation = never,
> = ChangeMutationState<
  S,
  {
    result: MergeSelection<ReturnedRecord<S>, Fields>
    rows: S["changed"]
    value: false
    returning: true
    uses: S["uses"] | U
  }
>

/** State of a mutation of state `S` that returns value `V` of each row it changes in rows mode `Rows`. */
type ValueState<S extends MutationQueryState, V, Rows extends ResultRows> = ChangeMutationState<
  S,
  { result: V; rows: Rows; value: true; returning: true }
>

/** State of a mutation of state `S` that returns the value of `E`, an expression or a query of one value that a callback returns, of each row it changes in rows mode `Rows`. */
type OperandState<
  S extends MutationQueryState,
  E extends TypedOperand,
  Rows extends ResultRows,
> = ChangeMutationState<
  S,
  {
    result: OperandValue<E>
    rows: Rows
    value: true
    returning: true
    uses: S["uses"] | OperandUses<E>
  }
>

/**
 * Immutable query of state `S` that inserts, updates, or deletes rows, unbound or bound to a `Db`.
 *
 * Without a selection, it resolves to the number of the rows it changes; `select`, `get`, and `pluck` return the fields of those rows instead.
 * An unbound query is not thenable, so it can be returned from async functions; it is compiled with `toSQL` or executed by a `Db`.
 * A bound query executes on its `Db` when awaited.
 */
// Like `SelectQuery`, it is covariant in its state and its kind, so that a `Db` executes it whatever its state.
export class MutationQuery<
  out S extends MutationQueryState,
  out Kind extends SelectQueryKind = "unbound",
> {
  declare readonly types: S
  /** `Db` that executes the query when it is awaited; `undefined` for an unbound query. */
  readonly db: QueryDb<Kind>
  /** Executes a bound query on its `Db`; `undefined` for an unbound query, so that it is not thenable. */
  // oxlint-disable-next-line unicorn/no-thenable -- awaiting a bound mutation executes it; unbound mutations are not thenable
  readonly then: QueryThen<S, Kind>

  constructor(
    readonly table: S["table"],
    readonly node: MutationNode,
    /** Relations of the table in the schema the query starts from, which its callbacks receive. */
    readonly context: QueryContext,
    db?: AnyDb,
  ) {
    this.db = db as QueryDb<Kind>
    // oxlint-disable-next-line unicorn/no-thenable -- only a bound mutation gets a function
    this.then = (db === undefined ? undefined : executeOnAwait) as QueryThen<S, Kind>
    Object.freeze(this)
  }

  /** Returns all columns of each changed row, replacing fields under their keys, instead of the number of the rows. */
  select<S extends RecordMutationState, Kind extends SelectQueryKind>(
    this: MutationQuery<S, Kind>,
    all: "*",
  ): MutationQuery<RecordsState<S, Selectable<S["table"]>>, Kind>
  /** Returns the listed columns of each changed row, replacing fields under their keys, instead of the number of the rows. */
  select<
    S extends RecordMutationState,
    Kind extends SelectQueryKind,
    K extends keyof S["table"]["columns"] & string,
  >(
    this: MutationQuery<S, Kind>,
    ...keys: K[]
  ): MutationQuery<RecordsState<S, Pick<Selectable<S["table"]>, K>>, Kind>
  /**
   * Returns the expressions and nested queries that `callback` returns for each changed row, replacing fields under their keys, instead of the number of the rows.
   *
   * `callback` receives the columns of the changed row, with their values after an insert or an update and those of the deleted row, and the queries of the relations of the table, as the callback of `select` of a select query does.
   * A nested query reads the database as it was before the change, apart from the changed row.
   */
  select<S extends RecordMutationState, Kind extends SelectQueryKind, Sel extends Selection>(
    this: MutationQuery<S, Kind>,
    callback: (columns: ColumnRefs<S["table"]> & RelationRefs<S["schema"]>) => Sel,
  ): MutationQuery<RecordsState<S, SelectionResult<Sel>, SelectionUses<Sel>>, Kind>
  select(...args: unknown[]): unknown {
    const { node } = this
    const { returning } = node
    if (returning !== undefined && node.value) {
      throw new Error(
        "select cannot be used after get or pluck; call get or pluck to replace the value",
      )
    }
    return this.derive({
      returning: mergeProjections(returning ?? [], node.target, args, this.context),
      value: false,
    })
  }

  /**
   * Returns the value of a column of the changed row instead of the number of the rows, in a query that changes one row, such as of `insert` or `find`.
   *
   * A query of a nullable row resolves to `undefined` without the row.
   */
  get<
    S extends OneRowMutationState,
    Kind extends SelectQueryKind,
    K extends keyof S["table"]["columns"] & string,
  >(
    this: MutationQuery<S, Kind>,
    key: K,
  ): MutationQuery<ValueState<S, Selectable<S["table"]>[K], OneValueRows<S["changed"]>>, Kind>
  /**
   * Returns the value of the expression that `callback` returns for the changed row instead of the number of the rows, in a query that changes one row, such as of `insert` or `find`.
   *
   * `callback` receives what the callback of `select` receives, and may return a query of one value, which gives `NULL` without its row.
   * A query of a nullable row resolves to `undefined` without the row.
   */
  get<S extends OneRowMutationState, Kind extends SelectQueryKind, E extends TypedOperand>(
    this: MutationQuery<S, Kind>,
    callback: (columns: ColumnRefs<S["table"]> & RelationRefs<S["schema"]>) => E,
  ): MutationQuery<OperandState<S, E, OneValueRows<S["changed"]>>, Kind>
  get(arg: unknown): unknown {
    if (this.node.rows === "many") {
      throw new Error(
        "get applies only to a query that changes one row, such as of insert or find; use pluck to return the values of several rows",
      )
    }
    return this.deriveValue(arg, "get")
  }

  /** Returns the value of a column of each changed row instead of the number of the rows, keeping whether the query returns an array or one value. */
  pluck<
    S extends MutationQueryState,
    Kind extends SelectQueryKind,
    K extends keyof S["table"]["columns"] & string,
  >(
    this: MutationQuery<S, Kind>,
    key: K,
  ): MutationQuery<ValueState<S, Selectable<S["table"]>[K], ValueRows<S["changed"]>>, Kind>
  /**
   * Returns the value of the expression that `callback` returns for each changed row instead of the number of the rows, keeping whether the query returns an array or one value.
   *
   * `callback` receives what the callback of `select` receives, and may return a query of one value, which gives `NULL` without its row.
   */
  pluck<S extends MutationQueryState, Kind extends SelectQueryKind, E extends TypedOperand>(
    this: MutationQuery<S, Kind>,
    callback: (columns: ColumnRefs<S["table"]> & RelationRefs<S["schema"]>) => E,
  ): MutationQuery<OperandState<S, E, ValueRows<S["changed"]>>, Kind>
  pluck(arg: unknown): unknown {
    return this.deriveValue(arg, "pluck")
  }

  /**
   * Compiles the query into SQL text and parameters; `schemaName` qualifies its tables.
   *
   * A query bound to a `Db` compiles as the `Db` executes it, with the PostgreSQL schema of the `Db`, and rejects options.
   */
  toSQL(...args: ToSQLArgs<Kind>): SqlStatement
  toSQL(options?: CompileOptions): SqlStatement {
    return compileToSQL(this, options)
  }

  /** Rejects the query as an operand of an expression, which takes a query of one value of a table. */
  [operandNode](): never {
    throw new TypeError(
      "An expression takes a query of one value of a table, such as of get, an aggregate, or exists, not a query of insert, update, or delete",
    )
  }

  /** Creates a mutation of the same kind and `Db` with the node changes applied. */
  private derive(changes: Partial<MutationNode>): AnyMutationQuery {
    return new MutationQuery(
      this.table,
      Object.freeze({ ...this.node, ...changes }) as MutationNode,
      this.context,
      this.db as AnyDb | undefined,
    )
  }

  /** Creates the mutation that returns the value of `arg` of `method`, a column key or a callback that receives the columns and the relations and returns an expression or a query of one value, of each changed row. */
  private deriveValue(arg: unknown, method: string): AnyMutationQuery {
    const { node } = this
    return this.derive({
      returning: [projectValue(node.target, arg, method, this.context)],
      value: true,
      rows: toValueRows(node.rows),
    })
  }
}

/** Query of any state and kind that inserts, updates, or deletes rows. */
// oxlint-disable-next-line typescript/no-explicit-any -- any mutation regardless of its result
export type AnyMutationQuery = MutationQuery<any, SelectQueryKind>

/**
 * Creates the insert of `records` into the table of `query`, which must have no clauses, in rows mode `rows`: `one` for `insert` and `many` for `insertMany`, named by `method`.
 *
 * It returns the number of the inserted rows, until a selection returns their fields.
 */
export function createInsert(
  query: AnySelectQuery,
  records: readonly unknown[],
  rows: "one" | "many",
  method: string,
): AnyMutationQuery {
  const { node } = query
  if (!isTableQuery(node)) {
    throw new Error(
      `${method} applies only to a query of a table without clauses, such as filters or selected fields; select the fields that it returns after it`,
    )
  }
  const { columns, values } = toInsertRows(node.from.table, records, method)
  return new MutationQuery(
    query.table,
    Object.freeze({
      kind: "insert",
      target: node.from,
      columns,
      values,
      returning: undefined,
      rows,
      value: false,
    }),
    query.context,
    query.db,
  )
}

/** Creates the update of the rows of `query` that `set` gives, as `update` takes it, in the rows mode of the query. */
export function createUpdate(query: AnySelectQuery, set: unknown): AnyMutationQuery {
  const { node } = query
  checkChangedRows(node, "update")
  return new MutationQuery(
    query.table,
    Object.freeze({
      kind: "update",
      target: node.from,
      set: toAssignments(node.from, set, query.context),
      filters: node.filters,
      returning: undefined,
      rows: node.rows,
      value: false,
    }),
    query.context,
    query.db,
  )
}

/** Creates the delete of the rows of `query`, in the rows mode of the query. */
export function createDelete(query: AnySelectQuery): AnyMutationQuery {
  const { node } = query
  checkChangedRows(node, "delete")
  return new MutationQuery(
    query.table,
    Object.freeze({
      kind: "delete",
      target: node.from,
      filters: node.filters,
      returning: undefined,
      rows: node.rows,
      value: false,
    }),
    query.context,
    query.db,
  )
}

// PostgreSQL has no limit or order of the rows of `UPDATE` and `DELETE`, so a query of `take` would change every row it filters; `find` and `findBy` add no limit, since the values of a key match at most one row.
/**
 * Rejects a query whose rows `method`, `update` or `delete`, cannot change: one of a relation, with selected fields, which a mutation selects after it, with an order, a limit, or an offset, or without a filter that restricts its rows unless `all` allows it.
 *
 * A filter simplified to `TRUE`, such as `where({})`, restricts no row.
 */
function checkChangedRows(node: QueryNode, method: string): void {
  if (node.relation !== undefined) {
    throw new Error(`${method} applies only to a query of a table, not of a relation`)
  }
  if (node.projections.length > 0) {
    throw new Error(
      `${method} returns the fields selected after it, not before; call select, get, or pluck after ${method}`,
    )
  }
  if (node.orderBy.length > 0 || node.limit !== undefined || node.offset !== undefined) {
    throw new Error(
      `${method} cannot sort or limit the rows it changes; choose them with where, find, or findBy instead of take, limit, offset, or orderBy`,
    )
  }
  const predicate = combineFilters(node.filters)
  if (!node.all && predicate.kind === "boolean" && predicate.value) {
    throw new Error(
      `${method} requires a filter that restricts the rows, such as of where or find; call all() to ${method} every row`,
    )
  }
}
