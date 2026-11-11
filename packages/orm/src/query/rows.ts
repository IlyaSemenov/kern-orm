// Rows modes of select queries: the mode of a query of a table or of a relation, how filters change them, the limit of `take`, and the result of a query state.

import type { ExpressionNode } from "../ast/nodes"
import { oneNode } from "../ast/nodes"
import type { ResultByRows, ResultRows } from "../database/result"
import type { RelationDefinition, RelationKind } from "../schema/relation"
import type { AnyTable } from "../table/table"

import type { QueryState } from "./state"

/** Rows mode of a query of a relation of kind `Kind`: `many`, or one row, `nullable` unless `Required` is `true`; a union gives the union of their modes. */
export type RelationRows<Kind extends RelationKind, Required extends boolean> = Kind extends "many"
  ? "many"
  : Required extends true
    ? "one"
    : "nullable"

// The relation guarantees only the record that it relates, not one that also passes a filter.
/** Rows mode after a filter of a query whose row a required relation guarantees: `one` becomes `nullable`, or `optional` for a query of values that `map` does not convert; other modes stay. */
export type FilteredRows<Rows extends ResultRows, Value> = Rows extends "one"
  ? Value extends true
    ? "optional"
    : "nullable"
  : Rows

/**
 * Result of a query of state `S`, executed or nested: an array of records or values, or one of them, `null` or `undefined` when a query of rows `nullable` or `optional` finds no row.
 *
 * It is the union of the results of every state that `S` allows, such as of a union of rows modes.
 */
export type QueryResult<S extends QueryState> = S extends QueryState
  ? ResultByRows<S["result"], S["rows"]>
  : never

/** Returns the rows mode of a query that starts from `table`, as `TableQueryState` gives it in types: `optional` of the one row of a singleton table, and `many` of the rows of another table. */
export function getTableRows(table: AnyTable): ResultRows {
  return table.singleton ? "optional" : "many"
}

/** Returns the rows mode of a query of the records of `relation`, as `RelationRows` gives it in types. */
export function getRelationRows(relation: RelationDefinition): ResultRows {
  if (relation.kind === "many") {
    return "many"
  }
  return relation.required ? "one" : "nullable"
}

/** Returns the rows mode after a filter of a query of rows mode `rows`, of values when `value`, whose row is `guaranteed`, as `FilteredStateRows` gives it in types. */
export function toFilteredRows(rows: ResultRows, value: boolean, guaranteed: boolean): ResultRows {
  if (!guaranteed || rows !== "one") {
    return rows
  }
  return value ? "optional" : "nullable"
}

// A limit of zero stays, so that `limit(0).take()` finds no row like `limit(0)`.
/** Returns the limit of a query of many rows that becomes a query of one row, given its limit `limit`: one row, or none under a limit of zero. */
export function limitToOne(limit: ExpressionNode | undefined): ExpressionNode {
  // Only `limit` sets the limit of a query of many rows, as a parameter of its count.
  return limit?.kind === "param" && limit.value === 0 ? limit : oneNode
}
