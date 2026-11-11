// Projections of a select statement: which of them has the value of an expression.

import type { ExpressionNode, ProjectionNode } from "./nodes"

/**
 * Returns the position of the projection that has the value of `expression`, such as a sort expression or a key of a group: a projection of the same value, as `isSameValue` tells, or `-1`.
 */
export function findValueProjection(
  projections: readonly ProjectionNode[],
  expression: ExpressionNode,
): number {
  return projections.findIndex(projection => isSameValue(projection.expression, expression))
}

/**
 * Tells whether `left` and `right` are sure to have the same value: they are the same column of the same source or the same expression node.
 *
 * Only the same node or column guarantees one value: PostgreSQL may or may not evaluate equal expressions built apart once, and gives each its own parameters.
 */
export function isSameValue(left: ExpressionNode, right: ExpressionNode): boolean {
  return left.kind === "column" && right.kind === "column"
    ? left.source === right.source && left.key === right.key
    : left === right
}
