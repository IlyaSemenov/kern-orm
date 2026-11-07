import type { ProjectionNode } from "../ast/nodes"
import { aggregatesOuterSource } from "../ast/references"
import type { QueryNode } from "../query/node"

/**
 * Rejects directly selected, unfiltered aggregates of an enclosing query in a query of groups.
 *
 * Types give these aggregates the nullability of their arguments in a nonempty group, but an enclosing query can have no rows.
 * A typed SQL fragment keeps its declared nullability and is the explicit escape hatch for an outer aggregate.
 */
export function checkGroupAggregates(
  projections: readonly ProjectionNode[],
  query: QueryNode,
): void {
  for (const field of projections) {
    const expression = field.expression
    // Counts stay non-null without rows; filtered aggregates and functions of aggregates retain their nullable types.
    if (
      expression.kind === "aggregate" &&
      expression.name !== "count" &&
      expression.filter === undefined &&
      aggregatesOuterSource(expression, query.from)
    ) {
      throw new Error(
        `An aggregate function of ${query.value ? "the grouped value" : `grouped field ${JSON.stringify(field.key)}`} refers only to enclosing queries; use an explicitly nullable sql expression for an outer aggregate`,
      )
    }
  }
}
