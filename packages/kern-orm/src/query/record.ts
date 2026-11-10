// Queries of `$select`: one record of the values of expressions and of literals and the results of independent queries, in one statement without a source.

import type { CompileOptions } from "../compiler/postgres/compile"
import type { SqlStatement } from "../database/driver"
import type { AnyDb } from "../execution/db"
import { operandNode } from "../expression/expression"
import type { UsedRelation } from "../schema/relation"

import type { QueryDb, QueryThen, SelectQueryKind, ToSQLArgs } from "./kind"
import { compileToSQL, executeOnAwait } from "./kind"
import type { RecordQueryNode, SelectedNode } from "./node"
import { addSelection } from "./projections"
import type { MergeSelection, Selection, SelectionResult, SelectionUses } from "./selection"
import type { EmptyRecord, QueryState } from "./state"

/** State of a query of `$select` in types: one record `R`, whose nested queries select records of relations `U`. */
export interface RecordQueryState<
  R = unknown,
  U extends UsedRelation = UsedRelation,
> extends QueryState {
  readonly result: R
  readonly rows: "one"
  readonly value: false
  readonly uses: U
}

/** State of the query of `$select` of `Sel`: the record of the values of its expressions and of its literals and the results of its queries. */
export type SelectionState<Sel extends Selection> = RecordQueryState<
  MergeSelection<EmptyRecord, SelectionResult<Sel>>,
  SelectionUses<Sel>
>

// Like `SelectQuery`, it is covariant in its state and its kind, so that a `Db` executes it whatever its record.
/**
 * Immutable query of `$select` of state `S`, unbound or bound to a `Db`: one record whose fields are the values of expressions and of literals and the results of independent queries, selected in one statement.
 *
 * An unbound query is not thenable, so it can be returned from async functions; it is compiled with `toSQL` or executed by a `Db`.
 * A bound query executes on its `Db` when awaited.
 */
export class RecordQuery<
  out S extends RecordQueryState,
  out Kind extends SelectQueryKind = "unbound",
> {
  declare readonly types: S
  /** `Db` that executes the query when it is awaited; `undefined` for an unbound query. */
  readonly db: QueryDb<Kind>
  /** Executes a bound query on its `Db`; `undefined` for an unbound query, so that it is not thenable. */
  // oxlint-disable-next-line unicorn/no-thenable -- awaiting a bound query executes it; unbound queries are not thenable
  readonly then: QueryThen<S, Kind>

  constructor(
    readonly node: RecordQueryNode,
    db?: AnyDb,
  ) {
    this.db = db as QueryDb<Kind>
    // oxlint-disable-next-line unicorn/no-thenable -- only a bound query gets a function
    this.then = (db === undefined ? undefined : executeOnAwait) as QueryThen<S, Kind>
    Object.freeze(this)
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
      "An expression takes a query of one value of a table, such as of get, an aggregate, or exists, not a query of $select",
    )
  }
}

/** Query of `$select` of any state and kind. */
// oxlint-disable-next-line typescript/no-explicit-any -- any query of `$select` regardless of its record
export type AnyRecordQuery = RecordQuery<any, SelectQueryKind>

/**
 * Starts the query of `$select` of `selection`, an object of expressions, queries, and literals by key, bound to `db` when given.
 *
 * It reads the keys and values of `selection` when it is called.
 */
export function startRecordQuery<S extends RecordQueryState, Kind extends SelectQueryKind>(
  selection: Selection,
  db?: AnyDb,
): RecordQuery<S, Kind> {
  const projections: SelectedNode[] = []
  addSelection(projections, selection)
  return new RecordQuery(Object.freeze({ kind: "record", projections }), db)
}
