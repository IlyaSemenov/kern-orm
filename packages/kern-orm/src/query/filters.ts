import { combineNodes } from "../ast/boolean"
import type { QueryFilters, TableSourceNode } from "../ast/nodes"
import type { ComparisonSignature, Operand } from "../expression/operators/comparison"
import type { EqualityOperator } from "../expression/operators/equality"
import type { ConditionOperand, Predicate } from "../expression/predicates"
import { toConditionNode } from "../expression/predicates"
import type { NoRelations, SchemaContext } from "../schema/relation"
import type { AnyTable, ColumnOperators, ColumnValues } from "../table/table"
import type { TypeInput, TypeOutput } from "../type/type"
import type { IsAny } from "../utils/type-helpers"

import type { ColumnRefs, QueryContext, RelationRefs } from "./column-refs"
import { createSelectionRefs } from "./column-refs"
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
  IsAny<ColumnOperators<T, K>> extends true
    ? ColumnValues<T>[K]
    : // The operand of the `eq` of `equalityOperators` is read from the type of the column: inferring it from the method with the check of `EqOperand` evaluates the result type of the operator, which adds about 165 instantiations to the first object condition of each column.
      ColumnOperators<T, K> extends { readonly eq: EqualityOperator<ComparisonSignature> }
      ? Operand<TypeOutput<T["columns"][K]["type"]>, TypeInput<T["columns"][K]["type"]>>
      : EqOperand<ColumnRefs<T>[K]>

/** Operand of the `eq` operator of an expression, if it has one taking a single operand and returning a predicate. */
export type EqOperand<E> = E extends { eq: (value: infer V) => Predicate } ? V : never

/** Filter of `where`: a Boolean expression, a query of one Boolean value, such as of `exists`, an object of column values, or their combination with `and`, `or`, and `not`. */
export type WhereCondition<T extends AnyTable> = ConditionOperand<WhereValues<T>>

// An intersection rather than one alias of both, as for the callback of `select`.
/** Callback of `where` over table `T` with schema context `C`: it receives the columns and the queries of the relations of the table and returns a condition. */
export type WhereCallback<T extends AnyTable, C extends SchemaContext = NoRelations> = (
  columns: ColumnRefs<T> & RelationRefs<C>,
) => WhereCondition<T>

/** Argument of `where` of a query over table `T` with schema context `C`: a condition, or a callback that receives the columns and the relations of the query and returns one. */
export type WhereFilter<T extends AnyTable, C extends SchemaContext = NoRelations> =
  | WhereCondition<T>
  | WhereCallback<T, C>

/** Creates query filters with the filter of `where` over `source` with the relations of `context` combined with `AND` with the user filters of `filters`. */
export function addUserFilter(
  filters: QueryFilters,
  filter: WhereFilter<AnyTable>,
  source: TableSourceNode,
  context: QueryContext,
): QueryFilters {
  const condition =
    typeof filter === "function"
      ? (filter as (refs: unknown) => unknown)(createSelectionRefs(source, context))
      : filter
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
export function defineFilter<T extends AnyTable, C extends SchemaContext = NoRelations>(
  table: TableOrQuery<T, C>,
  filter: NoInfer<WhereCondition<T>>,
): WhereCondition<T>
/**
 * Defines a reusable callback of `where` for queries over a table, checking its objects of column values against the columns.
 *
 * Defined with a query of a schema or a `Db`, such as `schema.form`, it receives the queries of the relations of the table in that schema, and applies to queries whose schema has them.
 * Another callback of `where` can call it with the columns and the relations it receives.
 */
export function defineFilter<T extends AnyTable, C extends SchemaContext = NoRelations>(
  table: TableOrQuery<T, C>,
  filter: NoInfer<WhereCallback<T, C>>,
): WhereCallback<T, C>
/** Defines a reusable filter of `where` for queries over a table, either a condition or a callback. */
export function defineFilter<T extends AnyTable, C extends SchemaContext = NoRelations>(
  table: TableOrQuery<T, C>,
  filter: NoInfer<WhereFilter<T, C>>,
): WhereFilter<T, C>
export function defineFilter(_table: unknown, filter: unknown): unknown {
  return filter
}
