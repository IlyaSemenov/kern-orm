// Rows modes of select queries: the mode of a query of a relation, how `take`, `get`, and `pluck` change them, and the result that each of them gives.

import type { ExpressionNode } from "../ast/nodes"
import { oneNode } from "../ast/nodes"
import type { ResultRows } from "../result/result"
import type { RelationDefinition, RelationKind } from "../schema/relation"

import type { SelectQueryState } from "./select"

/** Rows mode of a query of a relation of kind `Kind`: `many`, or one row, `nullable` unless `Required` is `true`; a union gives the union of their modes. */
export type RelationRows<Kind extends RelationKind, Required extends boolean> = Kind extends "many"
  ? "many"
  : Required extends true
    ? "one"
    : "nullable"

/** Rows mode after `take`: `many` becomes `one`; the modes of one row stay. */
export type OneRow<Rows extends ResultRows> = Rows extends "many" ? "one" : Rows

// The value of a missing record is never `null`, which would read as a `NULL` value.
/** Rows mode after `pluck`: `nullable` becomes `optional`; the other modes stay. */
export type ValueRows<Rows extends ResultRows> = Rows extends "nullable" ? "optional" : Rows

/** Rows mode after `get`: `many` becomes `one` and `nullable` becomes `optional`; `one` and `optional` stay. */
export type OneValueRows<Rows extends ResultRows> = Rows extends "many"
  ? "one"
  : Rows extends "nullable"
    ? "optional"
    : Rows

/**
 * Result of a query of state `S`, executed or nested: an array of records or values, or one of them, `null` or `undefined` when a query of rows `nullable` or `optional` finds no row.
 *
 * It is the union of the results of every state that `S` allows, such as of a union of rows modes.
 */
export type QueryResult<S extends SelectQueryState> = S extends SelectQueryState
  ? ResultByRows<S["result"], S["rows"]>
  : never

/** Result of rows of `Result` returned in rows mode `Rows`; a union of modes gives the union of their results. */
export type ResultByRows<Result, Rows extends ResultRows> = Rows extends "many"
  ? Result[]
  : Rows extends "one"
    ? Result
    : Rows extends "nullable"
      ? Result | null
      : Result | undefined

/** Returns the rows mode of a query of the records of `relation`, as `RelationRows` gives it in types. */
export function getRelationRows(relation: RelationDefinition): ResultRows {
  if (relation.kind === "many") {
    return "many"
  }
  return relation.required ? "one" : "nullable"
}

// A limit of zero stays, so that `limit(0).take()` finds no row like `limit(0)`.
/** Returns the limit of a query of many rows that becomes a query of one row, given its limit `limit`: one row, or none under a limit of zero. */
export function limitToOne(limit: ExpressionNode | undefined): ExpressionNode {
  // Only `limit` sets the limit of a query of many rows, as a parameter of its count.
  return limit?.kind === "param" && limit.value === 0 ? limit : oneNode
}

/** Returns the rows mode after `pluck` of a query of rows mode `rows`, as `ValueRows` gives it in types. */
export function toValueRows(rows: ResultRows): ResultRows {
  return rows === "nullable" ? "optional" : rows
}
