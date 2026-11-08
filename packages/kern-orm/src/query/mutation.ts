// Mutations of a table: inserts, updates, and deletes, which return the number of the rows they change or the fields of those rows.

import { combineFilters } from "../ast/boolean"
import type { AssignmentNode, ConflictNode, InsertNode, TableSourceNode } from "../ast/nodes"
import { createNode } from "../ast/nodes"
import type { CompileOptions } from "../compiler/postgres/compile"
import type { AnyDb } from "../execution/db"
import type { SqlStatement } from "../execution/driver"
import { operandNode } from "../expression/expression"
import type { TypedOperand } from "../expression/functions"
import type { OperandValue } from "../expression/operators/comparison"
import type { ResultRows } from "../result/result"
import type { SchemaContext, UsedRelation } from "../schema/relation"
import type { AnyTable, Selectable } from "../table/table"
import { findKey, requireColumn } from "../table/table"

import type { ColumnRefs, QueryContext, RelationRefs } from "./column-refs"
import type { SynchronousResult } from "./conversion"
import { addMap, addTransform } from "./conversion"
import type { KeyCheck } from "./find"
import { toConflictTarget } from "./find"
import type { Helper, HelperEffect, HelperError, ReadsContext } from "./helper"
import type { QueryDb, QueryThen, SelectQueryKind, ToSQLArgs } from "./kind"
import { compileToSQL, executeOnAwait } from "./kind"
import type { MutationNode, QueryNode, SelectedNode } from "./node"
import { isTableQuery } from "./node"
import type { OperandUses } from "./operand"
import { mergeProjections, projectValue } from "./projections"
import type { OneValueRows, QueryResult, ValueRows } from "./rows"
import { toValueRows } from "./rows"
import type { AnySelectQuery } from "./select"
import { requireDerived } from "./select"
import type { MergeSelection, Selection, SelectionResult, SelectionUses } from "./selection"
import type { EmptyRecord, QueryState } from "./state"
import type { ConflictUpdateSet, UpdateValues } from "./values"
import { toAssignments, toInsertRows } from "./values"

/**
 * State in types of a query that inserts, updates, or deletes rows: its table and the relations of its schema, the rows mode of the rows it changes, and its result, which is their number until a selection returns their fields or `transform` converts it.
 *
 * Methods change only their own parts of the state.
 */
export interface MutationQueryState extends QueryState {
  readonly table: AnyTable
  readonly schema: SchemaContext
  /** Rows mode of the rows that the query changes, which `select`, `get`, and `pluck` return. */
  readonly changed: ResultRows
  /** Whether the query resolves to something other than the number of the rows it changes: their fields or what `transform` makes of that number. */
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

/** State of an insert of `insert` or `insertMany` of table `T` with schema context `C` in rows mode `Rows`, before any other method. */
export interface InitialInsertState<
  T extends AnyTable,
  C extends SchemaContext,
  Rows extends ResultRows,
> extends InitialMutationState<T, C, Rows> {
  readonly insert: true
}

/** State of an insert that no method has changed since `insert` or `insertMany`, which `onConflict` applies to. */
export interface InsertMutationState extends MutationQueryState {
  // Outside of `MutationQueryState`, so that every change of the state by `ChangeMutationState` drops it, and other mutations do not carry it.
  readonly insert: true
}

/** Rows mode of the rows that an insert of rows mode `Rows` changes when it skips the rows that conflict: a missing row of an insert of one record. */
type SkippedRows<Rows extends ResultRows> = Rows extends "one" ? "optional" : Rows

// Apart from `ChangeState` of `select.ts`, so that changes of a select query cost no more and its methods take a union of queries that differ by their fields.
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

/** State of a mutation that `map` and `transform` do not convert, which `pluck` applies to. */
type UnconvertedMutationState = MutationQueryState & { readonly value: boolean }

/** State of a mutation of one row that `map` and `transform` do not convert, which `get` applies to. */
type OneRowMutationState = UnconvertedMutationState & {
  readonly changed: "one" | "nullable" | "optional"
}

/** State of a mutation that returns the fields of the rows it changes, which `map` applies to unless `transform` converts it; the number of the rows has no rows to convert. */
type ReturningMutationState = MutationQueryState & {
  readonly returning: true
  readonly value: boolean | "mapped"
}

/** Constraint of a mutation that does not accept a helper that filters or takes one row, whose methods it lacks. */
interface NotMutationEffect {
  readonly returning: HelperError<"A helper of a mutation can only select fields and map them">
}

/** Constraint of a mutation that accepts a helper of table `T` of effect `E`, whose callback reads the relations of its schema context from the mutation. */
type HelperMutationInput<T extends AnyTable, E extends HelperEffect> = MutationQueryState & {
  readonly table: T
  readonly schema: ReadsContext<E>
} & ([E["guaranteed"]] extends [true]
    ? [E["rows"]] extends ["many"]
      ? [E extends HelperEffect ? keyof E["fields"] : never, E["mapped"]] extends [never, false]
        ? unknown
        : RecordMutationState
      : NotMutationEffect
    : NotMutationEffect)

/** State of a mutation of state `S` after a helper of effect `E`: the rows that `map` gives, or the records with the fields that it selects. */
type HelperMutationState<
  S extends MutationQueryState,
  E extends HelperEffect,
> = E["mapped"] extends true
  ? ChangeMutationState<
      S,
      {
        result: E["output"]
        rows: S["changed"]
        value: "mapped"
        returning: true
        uses: S["uses"] | E["uses"]
      }
    >
  : [keyof E["fields"]] extends [never]
    ? ChangeMutationState<S, { uses: S["uses"] | E["uses"] }>
    : RecordsState<S, E["fields"], E["uses"]>

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
 * Without a selection, it resolves to the number of the rows it changes; `select`, `get`, and `pluck` return the fields of those rows instead, and `map` and `transform` convert them in code.
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
    this.rejectConverted("select")
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
    S extends UnconvertedMutationState,
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
  pluck<S extends UnconvertedMutationState, Kind extends SelectQueryKind, E extends TypedOperand>(
    this: MutationQuery<S, Kind>,
    callback: (columns: ColumnRefs<S["table"]> & RelationRefs<S["schema"]>) => E,
  ): MutationQuery<OperandState<S, E, ValueRows<S["changed"]>>, Kind>
  pluck(arg: unknown): unknown {
    return this.deriveValue(arg, "pluck")
  }

  /**
   * Converts each record or value that the mutation returns in code, after decoding, such as to add a field that SQL cannot compute; select the fields before it, since the number of the rows has no rows to convert, which `transform` converts instead.
   *
   * `callback` receives one record or value, also `null` of a `NULL` value, and is not called for a missing row; it returns its result synchronously.
   * A failure of `callback` rejects with `ResultDecodeError`, after the mutation has changed its rows.
   */
  map<S extends ReturningMutationState, Kind extends SelectQueryKind, R>(
    this: MutationQuery<S, Kind>,
    callback: (row: S["result"]) => R & SynchronousResult<R>,
  ): MutationQuery<ChangeMutationState<S, { result: R; value: "mapped" }>, Kind>
  map(callback: (row: unknown) => unknown): unknown {
    const { node } = this
    if (node.returning === undefined) {
      throw new Error(
        "map applies only to a mutation that returns the fields of its rows; select them before map, or call transform to convert the number of the rows",
      )
    }
    return this.derive({ conversion: addMap(node.conversion, callback) })
  }

  /**
   * Converts the whole result of the mutation in code, after decoding, such as the number of the rows it changes into whether it changed any.
   *
   * `callback` receives what the mutation resolves to, once, and returns its result synchronously; call `select`, `get`, `pluck`, and `map` before it.
   * A failure of `callback` rejects with `ResultDecodeError`, after the mutation has changed its rows.
   */
  transform<S extends MutationQueryState, Kind extends SelectQueryKind, R>(
    this: MutationQuery<S, Kind>,
    callback: (result: QueryResult<S>) => R & SynchronousResult<R>,
  ): MutationQuery<
    ChangeMutationState<S, { result: R; rows: "one"; value: "transformed"; returning: true }>,
    Kind
  >
  transform(callback: (result: unknown) => unknown): unknown {
    return this.derive({ conversion: addTransform(this.node.conversion, callback) })
  }

  // The result is constrained to the kind of this query, so a callback cannot change the binding, and a Promise or another value is rejected.
  // Before the overload of a helper, since TypeScript keeps the type that the first overload gives to the parameter of a callback, and a helper is no such callback, since it takes a query of a table.
  /**
   * Returns the mutation that `callback` builds from this mutation, such as one that selects the fields it returns.
   *
   * `callback` receives this mutation and `args` and returns this mutation or a mutation derived from it, which keeps the binding of this mutation.
   */
  use<
    Q,
    Kind extends SelectQueryKind,
    // oxlint-disable-next-line typescript/no-explicit-any -- a mutation of any state of this kind
    R extends MutationQuery<any, Kind>,
    A extends unknown[] = [],
  >(
    // oxlint-disable-next-line typescript/no-explicit-any -- the kind of a mutation of any state
    this: Q & MutationQuery<any, Kind>,
    callback: (query: Q, ...args: A) => R,
    ...args: A
  ): R
  // TypeScript infers the parameters of `Helper` from a helper by the alias, whereas a helper called with a mutation would need an overload of `Helper`, and `use` of a query of a table would infer a generic overloaded function from its last overload only.
  /**
   * Applies a helper of `defineHelper` that only selects fields and maps them to what the mutation returns, as `use` of a select query does.
   *
   * Another method of a query in the helper fails: types reject those that filter or take one row, but not `groupBy`, `orderBy`, `limit`, `offset`, `distinct`, `distinctOn`, and the row locks, which they do not tell from a selection.
   * A selection of no fields fails as well on a mutation that returns the number of its rows.
   */
  use<
    S extends HelperMutationInput<T, E>,
    Kind extends SelectQueryKind,
    T extends AnyTable,
    E extends HelperEffect,
    A extends unknown[],
  >(
    this: MutationQuery<S, Kind>,
    helper: Helper<T, E, A>,
    ...args: A
  ): E extends HelperEffect ? MutationQuery<HelperMutationState<S, E>, Kind> : never
  use(callback: (query: never, ...args: never[]) => unknown, ...args: never[]): unknown {
    const result = requireDerived(
      this,
      callback(this as never, ...args) as AnyMutationQuery,
      "The callback of use",
    )
    // The effect of a helper does not tell a selection of no fields from no selection, so types keep the number of the rows, whereas this selection returns empty records; a helper is a plain function here, so a callback is rejected too.
    if (this.node.returning === undefined && result.node.returning?.length === 0) {
      throw new Error(
        "The callback of use must select at least one field, or not call select to return the number of the rows",
      )
    }
    return result
  }

  // Rest columns take one key in any order, as the object of `findBy` does; each is checked, so that the error names the keys of the table.
  /**
   * Chooses the key, primary or unique, of `columns` on which a row of the insert may conflict with an existing record; without columns, `doNothing` skips a row that conflicts on any key, and `merge` and `update` update the row of a singleton table.
   *
   * Call it right after `insert` or `insertMany`, choose the action on its result, such as `doNothing()`, and select the fields that the mutation returns after the action.
   */
  onConflict<
    S extends InsertMutationState,
    Kind extends SelectQueryKind,
    K extends keyof S["table"]["columns"] & string = never,
  >(
    this: MutationQuery<S, Kind>,
    ...columns: (K & KeyCheck<S["table"], K>)[]
  ): ConflictTarget<S, Kind, K>
  onConflict(...columns: string[]): unknown {
    const { node } = this
    if (node.kind !== "insert") {
      throw new Error("onConflict applies only to insert and insertMany")
    }
    if (
      node.returning !== undefined ||
      node.conversion !== undefined ||
      node.conflict !== undefined
    ) {
      throw new Error(
        "onConflict applies right after insert or insertMany, once; call select, get, pluck, map, and transform after its action",
      )
    }
    return new ConflictTarget(this as AnyMutationQuery, toConflictTarget(this.table, columns))
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
    this.rejectConverted(method)
    const { node } = this
    return this.derive({
      returning: [projectValue(node.target, arg, method, this.context)],
      value: true,
      rows: toValueRows(node.rows),
    })
  }

  // The callbacks of `map` and `transform` read what the mutation returns, so a change of its fields would change what they receive.
  /** Rejects `method`, which changes the fields that the mutation returns, on a mutation that `map` or `transform` converts. */
  private rejectConverted(method: string): void {
    if (this.node.conversion !== undefined) {
      throw new Error(`${method} cannot be used after map or transform; call it before them`)
    }
  }
}

/** Query of any state and kind that inserts, updates, or deletes rows. */
// oxlint-disable-next-line typescript/no-explicit-any -- any mutation regardless of its result
export type AnyMutationQuery = MutationQuery<any, SelectQueryKind>

/**
 * Conflict target of an insert of state `S` on the key of columns `K`, or without columns for `never`, with methods that choose the action and return the mutation: without columns, `doNothing` takes any key, and `merge` and `update` the row of a singleton table.
 *
 * It is no query: awaiting it is a type error and rejects, so that an insert without an action does not resolve without running.
 */
// Like `MutationQuery`, it is covariant in its state, its kind, and its columns.
export class ConflictTarget<
  out S extends InsertMutationState,
  out Kind extends SelectQueryKind = "unbound",
  out K extends string = string,
> {
  constructor(
    /** Insert whose rows conflict. */
    readonly insert: MutationQuery<S, Kind>,
    /** Columns of the key that the rows conflict on, in its order, or none, as `onConflict` without columns gives them. */
    readonly target: readonly K[],
  ) {
    Object.freeze(this)
  }

  /**
   * Skips each row that conflicts, as `ON CONFLICT DO NOTHING`, and returns the mutation.
   *
   * After `insert`, the mutation resolves to `0` when the row conflicts, and the fields selected after it to `undefined`.
   * After `insertMany`, it resolves to the number of the inserted rows, and the fields selected after it are those of the inserted rows.
   */
  doNothing<S extends InsertMutationState, Kind extends SelectQueryKind>(
    this: ConflictTarget<S, Kind>,
  ): MutationQuery<ChangeMutationState<S, { changed: SkippedRows<S["changed"]> }>, Kind>
  doNothing(): unknown {
    const rows = this.insert.node.rows
    return this.derive(Object.freeze({ target: this.target }), rows === "one" ? "optional" : rows)
  }

  // The values come from the inserted rows, so a column that a record omits would take its default; it must be given by every record.
  /**
   * Updates the existing record of each row that conflicts with the values of `columns` of the row, as `DO UPDATE SET column = EXCLUDED.column`, or with every column that the insert gives, apart from the key, without columns, and returns the mutation of the inserted and the updated rows.
   *
   * Every record must give each column that it sets.
   * After `onConflict()` without columns, it updates the row of a singleton table.
   */
  merge<
    S extends InsertMutationState,
    Kind extends SelectQueryKind,
    K extends string,
    C extends Exclude<keyof S["table"]["columns"] & string, K>,
  >(
    this: ConflictTarget<S, Kind, K> & ConflictKeyCheck<S, K>,
    ...columns: C[]
  ): MutationQuery<ChangeMutationState<S, { changed: S["changed"] }>, Kind>
  merge(...columns: string[]): unknown {
    const { insert } = this
    const target: readonly string[] = this.target
    const updateTarget = toUpdateTarget(insert.table, target, "merge")
    const node = this.insertNode()
    const merged =
      columns.length === 0 ? node.columns.filter(key => !target.includes(key)) : columns
    if (merged.length === 0) {
      throw new Error(
        "merge has no column to set, since the insert gives no column apart from the key of onConflict; use doNothing",
      )
    }
    const excluded = createExcluded(insert.table)
    const set: AssignmentNode[] = []
    for (const key of merged) {
      requireColumn(insert.table, key)
      if (target.includes(key)) {
        throw new Error(`merge cannot set "${key}", a column of the key of onConflict`)
      }
      if (set.some(assignment => assignment.key === key)) {
        throw new Error(`merge takes each column once, not "${key}" twice`)
      }
      const index = node.columns.indexOf(key)
      if (index === -1 || node.values.some(row => row[index] === undefined)) {
        throw new Error(
          `merge cannot set "${key}", which a record does not give, so that its default would replace the value of the record; give it in every record or leave it out of merge`,
        )
      }
      set.push(Object.freeze({ key, value: createNode({ kind: "column", source: excluded, key }) }))
    }
    return this.derive(
      Object.freeze({ target: updateTarget, update: Object.freeze({ set, excluded }) }),
      node.rows,
    )
  }

  // Overloads as those of `update` of a select query, so that a callback records the relations of its values and a call that matches no overload reports the error of its own form.
  /**
   * Updates the existing record of each row that conflicts with the values that `callback` returns, as `DO UPDATE SET`, and returns the mutation of the inserted and the updated rows.
   *
   * `callback` receives the columns and the queries of the relations of the existing record, and the columns of the row proposed for insertion, `excluded`, such as to add its value to the existing one.
   * After `onConflict()` without columns, it updates the row of a singleton table.
   */
  update<
    S extends InsertMutationState,
    Kind extends SelectQueryKind,
    K extends string,
    F extends (
      columns: ColumnRefs<S["table"]> & RelationRefs<S["schema"]>,
      excluded: ColumnRefs<S["table"]>,
    ) => UpdateValues<S["table"]>,
  >(
    this: ConflictTarget<S, Kind, K> & ConflictKeyCheck<S, K>,
    callback: F,
  ): MutationQuery<
    ChangeMutationState<S, { uses: S["uses"] | OperandUses<ReturnType<F>[keyof ReturnType<F>]> }>,
    Kind
  >
  /**
   * Updates the existing record of each row that conflicts with the values of `set`, as `DO UPDATE SET`, and returns the mutation of the inserted and the updated rows.
   *
   * `set` gives the values of the columns to update, or is a callback that returns them from the existing record and the row proposed for insertion, `excluded`.
   * After `onConflict()` without columns, it updates the row of a singleton table.
   */
  update<S extends InsertMutationState, Kind extends SelectQueryKind, K extends string>(
    this: ConflictTarget<S, Kind, K> & ConflictKeyCheck<S, K>,
    set: ConflictUpdateSet<S["table"], S["schema"]>,
  ): MutationQuery<ChangeMutationState<S, { changed: S["changed"] }>, Kind>
  update(set: unknown): unknown {
    const { insert } = this
    const target = toUpdateTarget(insert.table, this.target, "update")
    const node = this.insertNode()
    const excluded = createExcluded(insert.table)
    const assignments = toAssignments(node.target, set, insert.context, excluded)
    return this.derive(
      Object.freeze({ target, update: Object.freeze({ set: assignments, excluded }) }),
      node.rows,
    )
  }

  // TypeScript rejects awaiting an object whose `then` takes no callback, and `await` rejects with the error of its call.
  /** Rejects awaiting the conflict target, which needs an action, such as `doNothing()`. */
  // oxlint-disable-next-line unicorn/no-thenable -- a `then` that takes no callback makes awaiting it a type error
  then(_action: ConflictActionRequired): never {
    throw new Error("onConflict needs an action before the mutation runs, such as doNothing()")
  }

  /** Returns the node of the insert, which `onConflict` takes only of an insert. */
  private insertNode(): InsertNode<SelectedNode> {
    return this.insert.node as InsertNode<SelectedNode>
  }

  /** Creates the insert of the same kind and `Db` with `conflict`, changing rows `rows`. */
  private derive(conflict: ConflictNode, rows: ResultRows): AnyMutationQuery {
    const { insert } = this
    const node = this.insertNode()
    return new MutationQuery(
      insert.table,
      Object.freeze({
        kind: "insert",
        target: node.target,
        columns: node.columns,
        values: node.values,
        conflict,
        returning: undefined,
        rows,
        value: false,
      }),
      insert.context,
      insert.db as AnyDb | undefined,
    )
  }
}

/** Type of the parameter of `then` of a conflict target, which makes awaiting the target before an action a type error. */
export interface ConflictActionRequired {
  readonly "onConflict needs an action, such as doNothing()": never
}

// The state rather than its table, which only a target of no columns reads.
/** Check of the columns `K` of a conflict target of an insert of state `S` that rejects `merge` and `update` of a conflict on any key, which PostgreSQL does not update, unless the table is a singleton table, whose row they update. */
type ConflictKeyCheck<S extends InsertMutationState, K extends string> = [K] extends [never]
  ? S["table"]["singleton"] extends true
    ? unknown
    : ConflictKeyRequired
  : unknown

/** Type that a conflict target on any key is checked against by `merge` and `update`, naming the reason. */
export interface ConflictKeyRequired {
  readonly "merge and update need the columns of a key in onConflict": never
}

/**
 * Returns the target of `DO UPDATE` of `method` of a conflict on the columns `target` of a key of `table`: the columns, or without them the unique index of `(true)` of a singleton table.
 *
 * It rejects a target without columns of another table, since PostgreSQL requires an explicit conflict target for `DO UPDATE`.
 */
function toUpdateTarget(
  table: AnyTable,
  target: readonly string[],
  method: string,
): readonly string[] | "singleton" {
  if (target.length > 0) {
    return target
  }
  if (table.singleton) {
    return "singleton"
  }
  throw new Error(
    `${method} needs the columns of a key in onConflict, since PostgreSQL updates a record only on a conflict of a named key`,
  )
}

/** Creates the occurrence of `table` that stands for the row proposed for insertion in `DO UPDATE`, `EXCLUDED` of PostgreSQL. */
function createExcluded(table: AnyTable): TableSourceNode {
  return Object.freeze({ kind: "table", table })
}

/**
 * Creates the insert of `records` into the table of `query`, which must have no clauses, in rows mode `rows`: `one` for `insert` and `many` for `insertMany`, named by `method`.
 *
 * It returns the number of the inserted rows, until a selection returns their fields.
 * It rejects an insert of rows `many` into a singleton table, which holds one row.
 */
export function createInsert(
  query: AnySelectQuery,
  records: readonly unknown[],
  rows: "one" | "many",
  method: string,
): AnyMutationQuery {
  if (!isTableQuery(query.node)) {
    throw new Error(
      `${method} applies only to a query of a table without clauses, such as filters or selected fields; select the fields that it returns after it`,
    )
  }
  const { table } = query
  if (rows === "many" && table.singleton) {
    throw new Error(
      `${method} cannot insert into singleton table "${table.name}", which holds one row; use insert or upsert`,
    )
  }
  return createInsertInto(query, records, rows, method)
}

// One statement of `ON CONFLICT ... DO UPDATE`, rather than an update followed by an insert without its row, so that concurrent upserts of a missing record do not reject with a unique violation.
/**
 * Creates the upsert of `values` by `query`, a query of `find` or `findBy` of a table without other clauses, or of a singleton table without clauses.
 *
 * It inserts the values of the key of `query` with `values`, and on a conflict on that key, or on the row of a singleton table, sets the columns of `values` of the existing record, as `merge` of `onConflict` does.
 * It rejects another query, values that are not an object, a value of a column of the key, and values without a value other than `undefined`.
 */
export function createUpsert(query: AnySelectQuery, values: unknown): AnyMutationQuery {
  const { table } = query
  const { foundKey } = query.node
  if (foundKey === undefined) {
    throw new Error(
      "upsert applies only to a query of a singleton table or right after find or findBy of a query of a table, without clauses such as filters, optional, or selected fields; select the fields that it returns after it",
    )
  }
  if (typeof values !== "object" || values === null) {
    throw new TypeError(`upsert takes the values of the columns of table "${table.name}"`)
  }
  const key = Object.keys(foundKey)
  const record: Record<string, unknown> = {}
  for (const column of key) {
    record[column] = foundKey[column]
  }
  let hasValues = false
  for (const column of Object.keys(values)) {
    const value = (values as Record<string, unknown>)[column]
    if (value === undefined) {
      continue
    }
    if (Object.hasOwn(foundKey, column)) {
      throw new Error(
        `upsert takes the values of the columns other than the key of find or findBy, not of "${column}"`,
      )
    }
    record[column] = value
    hasValues = true
  }
  if (!hasValues) {
    throw new Error(
      key.length === 0
        ? "upsert takes the value of at least one column; to insert the row unless it exists, use insert(...).onConflict().doNothing()"
        : "upsert takes the value of at least one column other than the key; to insert the record of the key unless it exists, use insert(...).onConflict(...).doNothing()",
    )
  }
  const insert = createInsertInto(query, [record], "one", "upsert")
  // `find` and `findBy` take only the values of the columns of a key, and the query of a singleton table has none, whose conflict `merge` takes on its row.
  return new ConflictTarget(insert, key.length === 0 ? key : findKey(table, key)!).merge()
}

/** Creates the insert of `records` into the occurrence of the table of `query`, whose clauses it does not read, in rows mode `rows` of the method named by `method`. */
function createInsertInto(
  query: AnySelectQuery,
  records: readonly unknown[],
  rows: "one" | "many",
  method: string,
): AnyMutationQuery {
  const { node } = query
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
 * Rejects a query whose rows `method`, `update` or `delete`, cannot change: one of a relation, with selected fields, which a mutation selects after it, with a conversion of `map`, which a mutation takes after it too, with keys of groups, whose rows SQL does not give, with an order, a limit, an offset, `distinct`, or `distinctOn`, with a row lock, which a mutation takes on its rows itself, or without a filter that restricts its rows unless `all` allows it or the table is a singleton table.
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
  if (node.conversion !== undefined) {
    throw new Error(
      `${method} returns what map converts after it, not before; call map after ${method}`,
    )
  }
  if (node.groupBy.length > 0) {
    throw new Error(
      `${method} changes rows rather than groups; choose them with where, find, or findBy instead of groupBy`,
    )
  }
  if (
    node.orderBy.length > 0 ||
    node.limit !== undefined ||
    node.offset !== undefined ||
    node.distinct ||
    node.distinctOn.length > 0
  ) {
    throw new Error(
      `${method} cannot sort or limit the rows it changes; choose them with where, find, or findBy instead of take, limit, offset, orderBy, distinct, or distinctOn`,
    )
  }
  if (node.lock !== undefined) {
    throw new Error(`${method} locks the rows it changes itself, so its query takes no row lock`)
  }
  // A singleton table holds one row at most, so a query of it changes that row without a filter, as a query of `find` changes the row of its key.
  if (node.all || node.from.table.singleton) {
    return
  }
  const predicate = combineFilters(node.filters)
  if (predicate.kind === "boolean" && predicate.value) {
    throw new Error(
      `${method} requires a filter that restricts the rows, such as of where or find; call all() to ${method} every row`,
    )
  }
}
