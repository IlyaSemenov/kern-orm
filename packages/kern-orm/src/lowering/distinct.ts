// Checks of a query of distinct or distinctOn that SQL cannot give the rows of, which reject it wherever it is.

import type { ExpressionNode, OrderNode, ProjectionNode } from "../ast/nodes"
import { findValueProjection, isSameValue } from "../ast/projections"

/**
 * Rejects a query of `distinct` of the lowered `projections` and `orderBy` that `SELECT DISTINCT` cannot give the rows of, with an error that does not depend on where the query is:
 *
 * - A query without projections, such as of only literals, has nothing to compare, and PostgreSQL has no syntax for it.
 * - Nested rows are JSON, which PostgreSQL cannot compare.
 * - PostgreSQL rejects a sort key that is not a projection, since duplicates can differ in its value, whereas a packed query would add it to the projections of its derived source and compare it too.
 *   Only a projection of the same column or of the same expression node is sure to have its value, as in `findValueProjection`.
 */
export function checkDistinct(
  projections: readonly ProjectionNode[],
  orderBy: readonly OrderNode[],
): void {
  if (projections.length === 0) {
    throw new Error(
      "distinct requires at least one selected column or SQL expression; literal fields are not compared",
    )
  }
  for (const { key, nested } of projections) {
    if (nested !== undefined) {
      throw new Error(`distinct cannot compare the nested rows of the selected field "${key}"`)
    }
  }
  for (const { expression } of orderBy) {
    if (findValueProjection(projections, expression) === -1) {
      throw new Error(
        "A query of distinct sorts only by its selected fields, since duplicates can differ in any other value; select the value to sort by it",
      )
    }
  }
}

/**
 * Rejects a query of `distinctOn` of the lowered `projections`, `keys`, and `orderBy` that `SELECT DISTINCT ON` cannot give the rows of, with an error that does not depend on where the query is:
 *
 * - A query without projections, such as of only literals, since PostgreSQL requires a select list with `DISTINCT ON`.
 * - An order that sorts by a value other than the keys before it sorts by all of them, in any order and direction, which PostgreSQL rejects, since the order sorts the groups apart and then chooses the first row of each; an order of only keys may omit some, which PostgreSQL adds.
 *   A sort key is a key when it is the same column, or the same expression node that a projection of the query has, as `findValueProjection` tells, so that both compile to the same column or position.
 *   Another expression may compile at each place with parameters and aliases of its own, so PostgreSQL may find the two unequal; the check runs before packing, which would add the expression to the projections of its derived source and make both positions, so that it counts as another value wherever the query is.
 */
export function checkDistinctOn(
  projections: readonly ProjectionNode[],
  keys: readonly ExpressionNode[],
  orderBy: readonly OrderNode[],
): void {
  if (projections.length === 0) {
    throw new Error(
      "distinctOn requires at least one selected column or SQL expression; literal fields are not selected",
    )
  }
  const isKey = (key: ExpressionNode, expression: ExpressionNode) =>
    isSameValue(key, expression) &&
    (key.kind === "column" || findValueProjection(projections, key) !== -1)
  let leading = 0
  while (leading < orderBy.length && keys.some(key => isKey(key, orderBy[leading]!.expression))) {
    leading++
  }
  if (leading === orderBy.length) {
    return
  }
  for (const key of keys) {
    let sorted = false
    for (let index = 0; index < leading && !sorted; index++) {
      sorted = isKey(key, orderBy[index]!.expression)
    }
    if (!sorted) {
      throw new Error(
        "A query of distinctOn must sort by all its keys before any other value; sort by a key of an expression through its selected field",
      )
    }
  }
}
