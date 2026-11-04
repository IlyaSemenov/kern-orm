import { combineNodes, negateNode } from "../ast/boolean"
import type { ExpressionNode } from "../ast/nodes"
import { createNode } from "../ast/nodes"
import type { ScalarQuery } from "../query/select"

import type { AnyExpression, Expression } from "./expression"
import { isOperandSource, operandNode, toBooleanExpression } from "./expression"
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
 * Operand of `and`, `or`, and `not`: a predicate, a query of one Boolean value, such as of `exists`, a condition, or an object of column values.
 *
 * Column values `V` are never inferred from an object, so that object keys are checked against the table instead of determining `V`.
 */
export type ConditionOperand<V, T extends boolean | null = boolean | null> =
  | AnyExpression<T>
  | ScalarQuery<T>
  | Condition<V>
  | NoInfer<V>

/** Converts a condition operand into a node: a query nests in it, and an object of column values stays unresolved until `where`; it rejects any other value. */
export function toConditionNode(operand: unknown): ExpressionNode {
  if (isOperandSource(operand)) {
    return operand[operandNode]()
  }
  if (!isColumnValues(operand)) {
    throw new TypeError(
      "A condition must be an expression, such as TRUE or FALSE, a query of one Boolean value, or an object of column values",
    )
  }
  return createNode({ kind: "values", values: operand as Record<string, unknown> })
}

// A value without keys reads as an empty object, which is `TRUE`, such as `where(false)` selecting every row, so only an empty plain object may lack them.
// An instance of a class with fields is an object of column values, as types take it, since the compiler checks its keys against the columns.
/** Tells whether `value` can be an object of column values: a plain object, of this or another realm, or an object that has keys. */
function isColumnValues(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  const prototype: unknown = Object.getPrototypeOf(value)
  return (
    prototype === null || Object.getPrototypeOf(prototype) === null || Object.keys(value).length > 0
  )
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
