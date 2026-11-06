// Kinds of select queries: an unbound query, or a query bound to a `Db` that executes it when awaited.

import type { CompileOptions } from "../compiler/postgres/compile"
import { compileStatement } from "../compiler/postgres/compile"
import type { AnyDb } from "../execution/db"
import type { SqlStatement } from "../execution/driver"
import { createStatement } from "../execution/driver"
import { lowerStatement } from "../lowering/lower"

import type { AnyTransformedQuery, TransformedQuery, TransformedQueryState } from "./conversion"
import type { AnyMutationQuery, MutationQuery, MutationQueryState } from "./mutation"
import type { AnyRecordQuery, RecordQuery, RecordQueryState } from "./record"
import type { QueryResult } from "./rows"
import type { AnySelectQuery, SelectQuery } from "./select"
import type { AnySqlQuery, SqlQuery, SqlQueryState } from "./sql-query"
import type { QueryState, SelectQueryState } from "./state"

/** Kind of a select query: `unbound`, or `bound` to a `Db`. */
export type SelectQueryKind = "unbound" | "bound"

// The members that differ by kind are typed by `Kind` rather than declared by a subclass, so that a query of either kind is one type whose methods TypeScript can call.
// TypeScript checks only `await` and async functions for a `then` that may be `undefined`: `Awaited`, and so `Promise.resolve` and `Promise.all`, take a query of either kind for the query itself.
/**
 * `then` of a query of kind `Kind`: a bound query executes when awaited, and an unbound query is not thenable.
 *
 * Awaiting a query of either kind or returning it from an async function is a type error, since it may execute.
 */
export type QueryThen<S extends QueryState, Kind extends SelectQueryKind> = [Kind] extends ["bound"]
  ? <R1 = QueryResult<S>, R2 = never>(
      onFulfilled?: ((result: QueryResult<S>) => R1 | PromiseLike<R1>) | null,
      onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
    ) => Promise<R1 | R2>
  : [Kind] extends ["unbound"]
    ? undefined
    : ((onFulfilled: never) => unknown) | undefined

/** `Db` of a query of kind `Kind`, which only a bound query has. */
export type QueryDb<Kind extends SelectQueryKind> = [Kind] extends ["bound"]
  ? AnyDb
  : [Kind] extends ["unbound"]
    ? undefined
    : AnyDb | undefined

/** Arguments of `toSQL` of a query of kind `Kind`: a bound query compiles with the options of its `Db`. */
export type ToSQLArgs<Kind extends SelectQueryKind> = [Kind] extends ["bound"]
  ? []
  : [options?: CompileOptions]

/** `then` of every bound query, which executes the query on its `Db`. */
export function executeOnAwait(
  this:
    | SelectQuery<SelectQueryState, "bound">
    | RecordQuery<RecordQueryState, "bound">
    | MutationQuery<MutationQueryState, "bound">
    | TransformedQuery<TransformedQueryState, "bound">
    | SqlQuery<SqlQueryState>,
  onFulfilled?: ((result: unknown) => unknown) | null,
  onRejected?: ((reason: unknown) => unknown) | null,
): Promise<unknown> {
  return this.db.$execute(this).then(onFulfilled, onRejected)
}

/** Query of any class, state, and kind: a select query of a table, one converted by `transform`, a query of `$select`, one that inserts, updates, or deletes rows, or a query of SQL text. */
export type AnyQuery =
  | AnySelectQuery
  | AnyTransformedQuery
  | AnyRecordQuery
  | AnyMutationQuery
  | AnySqlQuery

/** Compiles `query` as its `toSQL` does: an unbound query with `options`, and a bound query as its `Db` executes it, which takes no options. */
export function compileToSQL(query: AnyQuery, options: CompileOptions | undefined): SqlStatement {
  const { db } = query
  if (db === undefined) {
    const { text, parameters } = compileStatement(lowerStatement(query.node), options)
    return createStatement(text, parameters)
  }
  // A caller holding the query as a query of either kind can still pass options, which the `Db` would not apply.
  if (options !== undefined) {
    throw new Error("A query bound to a Db compiles with the options of its Db")
  }
  return db.$compile(query)
}
