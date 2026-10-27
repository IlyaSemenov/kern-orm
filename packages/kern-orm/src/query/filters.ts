import { combineNodes } from "../ast/boolean"
import type { QueryFilters, TableSourceNode } from "../ast/nodes"
import type { ConditionOperand, Predicate } from "../expression/predicates"
import { toConditionNode } from "../expression/predicates"
import type { AnyTable, ColumnOperators, ColumnValues } from "../table/table"
import type { IsAny } from "../utils/type-helpers"

import type { ColumnRefs } from "./column-refs"
import { createColumnRefs } from "./column-refs"
import { resolveValues } from "./resolve-values"
import type { TableOrQuery } from "./select"

/**
 * Filter by column values, each matched by the `eq` operator of its column; `null` matches `IS NULL`.
 *
 * A column without an `eq` operator of one operand accepts only `null` in this filter, when its input type includes `null`.
 */
export type WhereValues<T extends AnyTable> = {
  [K in keyof T["columns"]]?: EqValue<T, K> | (null extends ColumnValues<T>[K] ? null : never)
}

/** Operand of the `eq` operator of column `K` of table `T` in an object passed to `where`, such as an expression. */
export type EqValue<T extends AnyTable, K extends keyof T["columns"]> =
  // Operators of a table of any columns are `any`, and its values accept any value, so that a query over a specific table is a query over any table.
  IsAny<ColumnOperators<T, K>> extends true ? ColumnValues<T>[K] : EqOperand<ColumnRefs<T>[K]>

/** Operand of the `eq` operator of an expression, if it has one taking a single operand. */
type EqOperand<E> = E extends { eq: (value: infer V) => Predicate } ? V : never

/** Filter of `where`: a Boolean expression, an object of column values, or their combination with `and`, `or`, and `not`. */
export type WhereCondition<T extends AnyTable> = ConditionOperand<WhereValues<T>>

/** Argument of `where`: a condition, or a callback that receives the columns of the query and returns one. */
export type WhereFilter<T extends AnyTable> =
  | WhereCondition<T>
  | ((columns: ColumnRefs<T>) => WhereCondition<T>)

/** Creates query filters with the filter of `where` over `source` combined with `AND` with the user filters of `filters`. */
export function addUserFilter<T extends AnyTable>(
  filters: QueryFilters,
  filter: WhereFilter<T>,
  source: TableSourceNode,
): QueryFilters {
  const condition = typeof filter === "function" ? filter(createColumnRefs<T>(source)) : filter
  const predicate = resolveValues(toConditionNode(condition), source)
  const { user } = filters
  return Object.freeze({
    ...filters,
    user: user ? combineNodes("and", [user, predicate]) : predicate,
  })
}

/**
 * Defines a reusable condition of `where` for queries over a table, checking its objects of column values against the columns.
 *
 * The condition can be combined further with `and`, `or`, and `not`.
 */
export function defineFilter<T extends AnyTable>(
  table: TableOrQuery<T>,
  filter: NoInfer<WhereCondition<T>>,
): WhereCondition<T>
/**
 * Defines a reusable callback of `where` for queries over a table, checking its objects of column values against the columns.
 *
 * Another callback can call it with its columns.
 */
export function defineFilter<T extends AnyTable>(
  table: TableOrQuery<T>,
  filter: NoInfer<(columns: ColumnRefs<T>) => WhereCondition<T>>,
): (columns: ColumnRefs<T>) => WhereCondition<T>
/** Defines a reusable filter of `where` for queries over a table, either a condition or a callback. */
export function defineFilter<T extends AnyTable>(
  table: TableOrQuery<T>,
  filter: NoInfer<WhereFilter<T>>,
): WhereFilter<T>
export function defineFilter(_table: unknown, filter: unknown): unknown {
  return filter
}
