// Kinds of select queries: an unbound query, or a query bound to a `Db` that executes it when awaited.

import type { SqlStatement } from "kern-db"
import { createStatement } from "kern-db"

import type { CompileOptions } from "../compiler/postgres/compile"
import { compileStatement } from "../compiler/postgres/compile"
import type { AnyDb } from "../execution/db"
import { lowerStatement } from "../lowering/lower"

import type { AnyTransformedQuery, TransformedQuery, TransformedQueryState } from "./conversion"
import type { AnyMutationQuery, MutationQuery, MutationQueryState } from "./mutation"
import type { AnyRecordQuery, RecordQuery, RecordQueryState } from "./record"
import type { QueryResult } from "./rows"
import type { AnySelectQuery, SelectQuery } from "./select"
import type { QueryState, SelectQueryState } from "./state"

/** Kind of a select query: `unbound`, or `bound` to a `Db`. */
export type SelectQueryKind = "unbound" | "bound"

// The members of a bound query are interfaces rather than function types written in the conditional types of the kind: they cost fewer instantiations where TypeScript reads the members of a query, such as for a helper.
/** `then` of a bound query of state `S`, which fits `then` of a Promise of its result; its rejection handler receives the reason as `unknown`. */
export interface BoundQueryThen<S extends QueryState> {
  <R1 = QueryResult<S>, R2 = never>(
    onFulfilled?: ((result: QueryResult<S>) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2>
}

/** `catch` of a bound query of state `S`, which fits `catch` of a Promise of its result; its callback takes the reason of the rejection as `unknown`. */
export interface BoundQueryCatch<S extends QueryState> {
  <R = never>(
    onRejected?: ((reason: unknown) => R | PromiseLike<R>) | null,
  ): Promise<QueryResult<S> | R>
}

/** `finally` of a bound query of state `S`, which fits `finally` of a Promise of its result. */
export interface BoundQueryFinally<S extends QueryState> {
  (onFinally?: (() => void) | null): Promise<QueryResult<S>>
}

// The members that differ by kind are typed by `Kind` rather than declared by a subclass, so that a query of either kind is one type whose methods TypeScript can call.
// TypeScript checks only `await` and async functions for a `then` that may be `undefined`: `Awaited`, and so `Promise.resolve` and `Promise.all`, take a query of either kind for the query itself.
/**
 * `then` of a query of kind `Kind`: a bound query executes when awaited, and an unbound query is not thenable.
 *
 * Awaiting a query of either kind or returning it from an async function is a type error, since it may execute.
 */
export type QueryThen<S extends QueryState, Kind extends SelectQueryKind> = [Kind] extends ["bound"]
  ? BoundQueryThen<S>
  : [Kind] extends ["unbound"]
    ? undefined
    : ((onFulfilled: never) => unknown) | undefined

// The member of a query of either kind does not name the state, as that of `then` does not, which costs fewer instantiations at the first unbound query.
/**
 * `catch` of a query of kind `Kind`: a bound query executes as when awaited and handles its rejection, as `catch` of a Promise does, and an unbound query has none.
 *
 * A query of either kind may have none, so calling it is a type error.
 */
export type QueryCatch<S extends QueryState, Kind extends SelectQueryKind> = [Kind] extends [
  "bound",
]
  ? BoundQueryCatch<S>
  : [Kind] extends ["unbound"]
    ? undefined
    : ((onRejected: never) => unknown) | undefined

/**
 * `finally` of a query of kind `Kind`: a bound query executes as when awaited and calls its callback once it resolves or rejects, as `finally` of a Promise does, and an unbound query has none.
 *
 * A query of either kind may have none, so calling it is a type error.
 */
export type QueryFinally<S extends QueryState, Kind extends SelectQueryKind> = [Kind] extends [
  "bound",
]
  ? BoundQueryFinally<S>
  : [Kind] extends ["unbound"]
    ? undefined
    : ((onFinally: never) => unknown) | undefined

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

/** Bound query of any class and state. */
type BoundQuery =
  | SelectQuery<SelectQueryState, "bound">
  | RecordQuery<RecordQueryState, "bound">
  | MutationQuery<MutationQueryState, "bound">
  | TransformedQuery<TransformedQueryState, "bound">

/** `then` of every bound query, which executes the query on its `Db`. */
export function executeOnAwait(
  this: BoundQuery,
  onFulfilled?: ((result: unknown) => unknown) | null,
  onRejected?: ((reason: unknown) => unknown) | null,
): Promise<unknown> {
  return this.db.$execute(this).then(onFulfilled, onRejected)
}

/** `catch` of every bound query, which executes the query on its `Db` as `then` does. */
function executeOnCatch(
  this: BoundQuery,
  onRejected?: ((reason: unknown) => unknown) | null,
): Promise<unknown> {
  return this.db.$execute(this).catch(onRejected)
}

/** `finally` of every bound query, which executes the query on its `Db` as `then` does. */
function executeOnFinally(this: BoundQuery, onFinally?: (() => void) | null): Promise<unknown> {
  return this.db.$execute(this).finally(onFinally)
}

/** Returns `catch` of `query`, which only a bound query has, as it has `then`. */
export function getQueryCatch<S extends QueryState, Kind extends SelectQueryKind>(query: {
  readonly types: S
  readonly db: QueryDb<Kind>
}): QueryCatch<S, Kind> {
  return (query.db === undefined ? undefined : executeOnCatch) as QueryCatch<S, Kind>
}

/** Returns `finally` of `query`, which only a bound query has, as it has `then`. */
export function getQueryFinally<S extends QueryState, Kind extends SelectQueryKind>(query: {
  readonly types: S
  readonly db: QueryDb<Kind>
}): QueryFinally<S, Kind> {
  return (query.db === undefined ? undefined : executeOnFinally) as QueryFinally<S, Kind>
}

/** Query of any class, state, and kind: a select query of a table, one converted by `transform`, a query of `$select`, or one that inserts, updates, or deletes rows. */
export type AnyQuery = AnySelectQuery | AnyTransformedQuery | AnyRecordQuery | AnyMutationQuery

/** Compiles `query` as its `toSQL` does: an unbound query with `options`, and a bound query as its `Db` executes it, which takes no options. */
export function compileToSQL(query: AnyQuery, options: CompileOptions | undefined): SqlStatement {
  const { db } = query
  if (db === undefined) {
    const { node } = query
    const { text, parameters } = compileStatement(
      lowerStatement(node),
      options,
      undefined,
      undefined,
      node.comment,
    )
    return createStatement(text, parameters)
  }
  // A caller holding the query as a query of either kind can still pass options, which the `Db` would not apply.
  if (options !== undefined) {
    throw new Error("A query bound to a Db compiles with the options of its Db")
  }
  return db.$compile(query)
}
