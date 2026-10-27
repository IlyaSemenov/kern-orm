// Sort keys that are projections: the same value as a selected field, referred to by the position of its projection.

import type { ExpressionNode, OrderNode, ProjectionNode, RawSqlNode } from "../ast/nodes"
import { createNode } from "../ast/nodes"

/**
 * Returns the position of the projection that has the value of the sort expression `expression`: a projection of the same column or of the same expression node, or `-1`.
 *
 * Only the same node or column guarantees one value: PostgreSQL may or may not evaluate equal expressions built apart once, and gives each its own parameters.
 */
export function findSortProjection(
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

/** Creates the number of the projection at `position`, by which `ORDER BY` sorts by its value instead of evaluating an expression again. */
export function createPositionNode(position: number): RawSqlNode {
  return createNode({ kind: "raw", fragments: [String(position + 1)], values: [] })
}

/** Creates the order of a statement that sorts by the positions of the projections among `projections` that have the values of its sort expressions, and by the other expressions as they are. */
export function sortByPositions(
  orderBy: readonly OrderNode[],
  projections: readonly ProjectionNode[],
): readonly OrderNode[] {
  const result: OrderNode[] = []
  for (const order of orderBy) {
    const position = findSortProjection(projections, order.expression)
    result.push(
      position === -1
        ? order
        : Object.freeze({
            expression: createPositionNode(position),
            direction: order.direction,
            nulls: order.nulls,
          }),
    )
  }
  return result
}
