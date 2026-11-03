// Pagination of select queries: the counts of `limit` and `offset` and the queries they apply to.

import type { ExpressionNode } from "../ast/nodes"
import { createNode } from "../ast/nodes"

import { isAggregateQuery } from "./aggregate"
import { isExistsQuery } from "./exists"
import type { QueryNode } from "./node"

// A query of one row has no pagination, which would hide a second row that it must reject.
/** Creates the parameter of the number of rows of `limit` or `offset`, named by `method`, of query `node`, rejecting a query of one row and a count that is not a non-negative safe integer. */
export function createPageCount(
  node: QueryNode,
  method: "limit" | "offset",
  count: number,
): ExpressionNode {
  if (node.rows !== "many") {
    throw new Error(`${method} applies only to a query of many rows${createPaginationHint(node)}`)
  }
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError(`${method} takes a non-negative integer, not ${count}`)
  }
  return createNode({ kind: "param", value: count, type: undefined })
}

/** Creates the hint of the error of `limit` or `offset` of query `node` of one row: the method to call them before, if any. */
function createPaginationHint(node: QueryNode): string {
  // A query of a relation `one` has one row from its start.
  if (node.relation?.kind === "one") {
    return ""
  }
  // An aggregate and `exists` take the rows of the page that a limit and an offset before them choose.
  if (isAggregateQuery(node)) {
    return "; call it before count or another aggregate to aggregate the rows of a page"
  }
  if (isExistsQuery(node)) {
    return "; call it before exists to check the rows of a page"
  }
  return "; call it before take or get"
}
