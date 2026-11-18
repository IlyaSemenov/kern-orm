import { createNode } from "../../ast/nodes"
import type { AnyType } from "../../type/type"
import type { AnyExpression } from "../expression"
import { getType, toExpression, toNode, toValueNode } from "../expression"

/**
 * Applies a binary SQL operator of a value, such as `+`, to an expression and an operand, and returns an expression of `type`.
 *
 * A plain operand is encoded with the type of the expression without a cast, since the expression types its parameter, as a compared value is.
 */
export function applyBinaryOperator(
  self: AnyExpression,
  operator: string,
  value: unknown,
  type: AnyType | undefined,
): AnyExpression {
  const node = createNode({
    kind: "binary",
    operator,
    left: toNode(self),
    right: toValueNode(value, getType(self)),
  })
  return toExpression(node, type)
}
