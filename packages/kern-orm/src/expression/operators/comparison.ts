import type { ComparisonNode, ExpressionNode } from "../../ast/nodes"
import { createNode } from "../../ast/nodes"
import type { AnyType } from "../../type/type"
import type { AnyExpression, Expression } from "../expression"
import { getType, toBooleanExpression, toNode, toValueNode } from "../expression"

import type { OperatorSignature } from "./generic"

/** Value compared with an expression of type `T` accepting values of type `I`; `null` is matched with `isNull` instead. */
export type Operand<T, I = T> = NonNullable<I> | AnyExpression<NonNullable<T> | null>

/** SQL value of an operand, unwrapping an expression. */
export type OperandValue<V> = V extends AnyExpression<infer T> ? T : V

/** Boolean result that can be NULL when an input value can be NULL. */
export type BooleanResult<T> = boolean | (null extends T ? null : never)

/** Signature of a generic operator comparing an expression with an operand of its type, such as `lt`. */
export interface ComparisonSignature extends OperatorSignature {
  readonly method: <V extends Operand<this["T"], this["I"]>>(
    value: V,
  ) => Expression<BooleanResult<this["T"] | OperandValue<V>>>
}

/**
 * Compares an expression with a value or another expression, encoding a plain value with the type of the expression.
 *
 * Operators of custom types build comparisons with it, such as `compare(self, "ILIKE", pattern)`.
 */
export function compare<T, V>(
  self: AnyExpression<T>,
  operator: ComparisonNode["operator"],
  value: V,
): Expression<BooleanResult<T | OperandValue<V>>>
export function compare(
  self: AnyExpression,
  operator: ComparisonNode["operator"],
  value: unknown,
): Expression<boolean | null> {
  return toBooleanExpression(compareNodes(operator, toNode(self), value, getType(self)))
}

/** Creates a comparison node, encoding a plain `right` value with `type`. */
export function compareNodes(
  operator: ComparisonNode["operator"],
  left: ExpressionNode,
  right: unknown,
  type: AnyType | undefined,
): ExpressionNode {
  return createNode({ kind: "comparison", operator, left, right: toValueNode(right, type) })
}
