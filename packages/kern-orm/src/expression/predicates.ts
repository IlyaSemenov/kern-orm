import { combineNodes, negateNode } from "../ast/boolean"
import type { ExpressionNode } from "../ast/nodes"
import { createNode } from "../ast/nodes"

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
 * Operand of `and`, `or`, and `not`: a predicate, a condition, or an object of column values.
 *
 * Column values `V` are never inferred from an object, so that object keys are checked against the table instead of determining `V`.
 */
export type ConditionOperand<V, T extends boolean | null = boolean | null> =
  | AnyExpression<T>
  | Condition<V>
  | NoInfer<V>

/** Converts a condition operand into a node; an object of column values stays unresolved until `where`. */
export function toConditionNode(operand: unknown): ExpressionNode {
  return isExpression(operand)
    ? toNode(operand)
    : createNode({ kind: "values", values: operand as Record<string, unknown> })
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
