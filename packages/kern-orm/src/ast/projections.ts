// Projections of a select statement: which of them has the value of an expression.

import type { ExpressionNode, ProjectionNode } from "./nodes"

/**
 * Returns the position of the projection that has the value of `expression`, such as a sort expression or a key of a group: a projection of the same column or of the same expression node, or `-1`.
 *
 * Only the same node or column guarantees one value: PostgreSQL may or may not evaluate equal expressions built apart once, and gives each its own parameters.
 */
export function findValueProjection(
  projections: readonly ProjectionNode[],
  expression: ExpressionNode,
): number {
  return projections.findIndex(projection => {
    const selected = projection.expression
    return expression.kind === "column" && selected.kind === "column"
      ? selected.source === expression.source && selected.key === expression.key
      : selected === expression
  })
}
