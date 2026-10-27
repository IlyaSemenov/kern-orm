// Kinds of select queries: an unbound query, or a query bound to a `Db` that executes it when awaited.

import type { CompileOptions } from "../compiler/postgres/compile"
import type { AnyDb } from "../execution/db"

import type { QueryResult } from "./rows"
import type { SelectQuery, SelectQueryState } from "./select"

/** Kind of a select query: `unbound`, or `bound` to a `Db`. */
export type SelectQueryKind = "unbound" | "bound"

// The members that differ by kind are typed by `Kind` rather than declared by a subclass, so that a query of either kind is one type whose methods TypeScript can call.
// TypeScript checks only `await` and async functions for a `then` that may be `undefined`: `Awaited`, and so `Promise.resolve` and `Promise.all`, take a query of either kind for the query itself.
/**
 * `then` of a query of kind `Kind`: a bound query executes when awaited, and an unbound query is not thenable.
 *
 * Awaiting a query of either kind or returning it from an async function is a type error, since it may execute.
 */
export type QueryThen<S extends SelectQueryState, Kind extends SelectQueryKind> = [Kind] extends [
  "bound",
]
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
  this: SelectQuery<SelectQueryState, "bound">,
  onFulfilled?: ((result: unknown) => unknown) | null,
  onRejected?: ((reason: unknown) => unknown) | null,
): Promise<unknown> {
  return this.db.$execute(this).then(onFulfilled, onRejected)
}
