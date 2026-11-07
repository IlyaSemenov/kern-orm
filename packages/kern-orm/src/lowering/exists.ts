// Lowering of a query of exists to EXISTS of the rows that the query chooses.

import type { ExistsNode } from "../ast/nodes"
import { createNode, noJoins, noOrder, noProjections } from "../ast/nodes"
import type { QueryNode } from "../query/node"

import type { LoweringContext } from "./context"
import { checkRelation } from "./context"
import { lowerDistinctRows } from "./distinct"
import { lowerFilters, lowerKeys, lowerValue } from "./expression"

// Whether a row exists depends on neither the selected fields, including nested queries, nor the order, even of the rows of a page, so the query of `EXISTS` has neither, apart from the fields that `distinct` compares and the keys of `distinctOn`.
/** Lowers a query of `exists` to `EXISTS` of the rows that its filters, limit, and offset choose, also the distinct rows of `distinct` and the first rows of `distinctOn`. */
export function lowerExists(node: QueryNode, context: LoweringContext): ExistsNode {
  checkRelation(node, context)
  return createNode({
    kind: "exists",
    query:
      node.distinctFields === undefined
        ? Object.freeze({
            kind: "select",
            from: node.from,
            joins: noJoins,
            projections: noProjections,
            filters: lowerFilters(node.filters, context),
            groupBy: lowerKeys(node.groupBy, context),
            having: lowerValue(node.having, context),
            orderBy: noOrder,
            limit: node.limit,
            offset: node.offset,
            rows: "many",
            value: false,
            guaranteedBy: undefined,
          })
        : lowerDistinctRows(node, context, undefined, false).query,
  })
}
