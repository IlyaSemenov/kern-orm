import { combineNodes } from "../ast/boolean"
import type { ExpressionNode, QueryFilters, TableSourceNode } from "../ast/nodes"
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
import type { SelectQueryState } from "./state"

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
    : // The operand of the `eq` of `equalityOperators` is read from the type of the column, which costs less than inferring it from the method with the check of `EqOperand`, since that evaluates the result type of the operator.
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

/**
 * Argument of `where` of a query of state `S`: a `WhereFilter` of its table and schema, which TypeScript resolves with what it has inferred for `S` before it checks a callback in it.
 *
 * TypeScript types the body of a callback once, for every overload, and a plain `WhereFilter` leaves `S` unresolved there, so the body would widen a literal, such as of an enum column, to `string`.
 * It reads the filter only in its branch, since a general alias that takes the filter as an argument resolves it on every call.
 */
export type QueryWhereFilter<S extends SelectQueryState> = [S] extends [unknown]
  ? WhereFilter<S["table"], S["schema"]>
  : never

/** Creates query filters with the filter of `where` over `source` with the relations of `context` combined with `AND` with the user filters of `filters`. */
export function addUserFilter(
  filters: QueryFilters,
  filter: WhereFilter<AnyTable>,
  source: TableSourceNode,
  context: QueryContext,
): QueryFilters {
  const predicate = toFilterNode(filter, source, context)
  const { user } = filters
  return Object.freeze({
    ...filters,
    user: user ? combineNodes("and", [user, predicate]) : predicate,
  })
}

/**
 * Converts a filter of `where` or `having` over `source` with the relations of `context` into the node of its condition, whose objects of column values it resolves.
 *
 * A callback receives the columns with the relations, and what `readSelected` returns, such as the selected fields for `having`.
 */
export function toFilterNode(
  filter: WhereFilter<AnyTable>,
  source: TableSourceNode,
  context: QueryContext,
  readSelected?: () => unknown,
): ExpressionNode {
  const condition =
    typeof filter === "function"
      ? (filter as (refs: unknown, selected: unknown) => unknown)(
          createSelectionRefs(source, context),
          readSelected?.(),
        )
      : filter
  return resolveValues(toConditionNode(condition), source)
}
