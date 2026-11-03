import { combineNodes, negateNode } from "../ast/boolean"
import type { ExpressionNode } from "../ast/nodes"
import { createNode } from "../ast/nodes"
import { MutationQuery } from "../query/mutation"
import { RecordQuery } from "../query/record"
import type { ConditionValueOf, QueryOf } from "../query/select"
import { SelectQuery } from "../query/select"
import { SqlQuery } from "../query/sql-query"
import type { SelectQueryState } from "../query/state"

import type { AnyExpression, Expression } from "./expression"
import { isExpression, toBooleanExpression, toNode } from "./expression"
import type { BooleanResult } from "./operators/comparison"

declare const conditionValues: unique symbol

/** Predicate accepted by `where`, `and`, `or`, and `not`; SQL treats a `NULL` predicate as not satisfied. */
export type Predicate = AnyExpression<boolean | null>

/**
 * Condition combining expressions with objects of column values, such as `or({ published: true }, form.id.in(ids))`.
 *
 * `where` matches the objects against the columns of its query, so a condition is accepted only where `V` matches the table.
 */
export interface Condition<V> {
  readonly [conditionValues]?: V
}

/**
 * Query of one Boolean value of a table, such as of `exists`, of an aggregate, or of `get`, which a condition takes as `EXISTS` of the rows of a query of `exists`, or as a scalar subquery of the value of another query.
 *
 * `T` is its value in the condition: without its row, a query of `get` is `NULL` there, unless a required relation guarantees the row, such as of `field.form`.
 */
// An interface rather than an intersection with `QueryOf`, which TypeScript would compare with every method of the query.
export interface ConditionQuery<
  T extends boolean | null = boolean | null,
> extends ConditionValueOf<T> {
  readonly types: ConditionQueryState
  // A method of a query, which TypeScript drops from the type of a spread copy of a query, so that such a copy is rejected.
  readonly exists: unknown
}

/** State of a query of one Boolean value, which a condition takes. */
interface ConditionQueryState extends SelectQueryState {
  readonly result: boolean | null
  readonly rows: "one" | "optional"
  readonly value: true
}

/**
 * Operand of `and`, `or`, and `not`: a predicate, a query of one Boolean value, a condition, or an object of column values.
 *
 * Column values `V` are never inferred from an object, so that object keys are checked against the table instead of determining `V`.
 */
export type ConditionOperand<V, T extends boolean | null = boolean | null> =
  | AnyExpression<T>
  | ConditionQuery<T>
  | Condition<V>
  | NoInfer<V>

/** Converts a condition operand into a node: a query nests in it, and an object of column values stays unresolved until `where`. */
export function toConditionNode(operand: unknown): ExpressionNode {
  if (isExpression(operand)) {
    return toNode(operand)
  }
  if (operand instanceof SelectQuery) {
    return toConditionQueryNode(operand)
  }
  if (
    operand instanceof RecordQuery ||
    operand instanceof MutationQuery ||
    operand instanceof SqlQuery
  ) {
    throw new TypeError(
      "A condition takes a query of one Boolean value of a table, such as of exists, not a query of $select, insert, update, delete, or $query",
    )
  }
  return createNode({ kind: "values", values: operand as Record<string, unknown> })
}

/** Creates the node of a query of a condition, which must be a query of one value, as `ConditionQuery` types it. */
function toConditionQueryNode(query: QueryOf<SelectQueryState>): ExpressionNode {
  const { node } = query
  if (!node.value || node.rows === "many") {
    throw new TypeError(
      "A condition takes a query of one Boolean value, such as of exists, not a query of records or of an array",
    )
  }
  return createNode({ kind: "nestedQuery", query: node, db: query.db })
}

// TypeScript takes the column values `V` from condition operands, or from the table of the enclosing `where`, `defineFilter`, or annotated variable.
// Without them, `V` is `never`: object operands are rejected, and the result is a Boolean expression.
// Each function has a single signature: TypeScript checks a nested call once against the first overload of the enclosing call and keeps the result, so a nested call would lose the table.

/**
 * Result of `and`, `or`, and `not`: a condition checked against the table inside `where`, a Boolean expression without a table.
 */
export type CombinedCondition<V, T extends boolean | null = boolean | null> = [V] extends [never]
  ? Expression<BooleanResult<T>>
  : Condition<V>

/** Combines predicates with `AND`; no operands yield `TRUE`. */
export function and<
  V = never,
  T extends boolean | null = [V] extends [never] ? boolean : boolean | null,
>(...operands: ConditionOperand<V, T>[]): CombinedCondition<V, T>
export function and(...operands: unknown[]): unknown {
  return combineConditions("and", operands)
}

/** Combines predicates with `OR`; no operands yield `FALSE`. */
export function or<
  V = never,
  T extends boolean | null = [V] extends [never] ? boolean : boolean | null,
>(...operands: ConditionOperand<V, T>[]): CombinedCondition<V, T>
export function or(...operands: unknown[]): unknown {
  return combineConditions("or", operands)
}

/** Negates a predicate. */
export function not<
  V = never,
  T extends boolean | null = [V] extends [never] ? boolean : boolean | null,
>(operand: ConditionOperand<V, T>): CombinedCondition<V, T>
export function not(operand: unknown): unknown {
  return toBooleanExpression(negateNode(toConditionNode(operand)))
}

function combineConditions(kind: "and" | "or", operands: unknown[]): Expression<boolean | null> {
  const nodes: ExpressionNode[] = []
  for (const operand of operands) {
    nodes.push(toConditionNode(operand))
  }
  return toBooleanExpression(combineNodes(kind, nodes))
}
