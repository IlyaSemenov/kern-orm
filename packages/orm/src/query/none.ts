// Queries of `none`: the filters that choose no row, and the statements of them that a `Db` resolves without running.

import type { ExpressionNode, OrderNode, QueryFilters, SourceNode } from "../ast/nodes"
import { falseNode } from "../ast/nodes"
import { visitNodes } from "../ast/references"

import { isAggregateProjection, isAggregateQuery } from "./aggregate"
import { isExistsQuery } from "./exists"
import type { MutationNode, QueryNode, RecordQueryNode, SelectedNode } from "./node"
import { isLiteralSelection, isNestedSelection } from "./node"

/** Creates query filters of `none`, which choose no row: `filters` with the user filter `FALSE` and the mark of `none`. */
export function addNoneFilter(filters: QueryFilters): QueryFilters {
  // `FALSE AND x` is `FALSE`, so the previous user filters, which `FALSE` replaces, choose no other rows.
  return Object.freeze({ ...filters, user: falseNode, none: true })
}

/**
 * Tells whether the statement of `node` returns and changes no row because of `none`, so that a `Db` resolves it from a result without rows without running it: of a query of rows, of an update, or of a delete.
 *
 * The statement of an aggregate query or of a query of `exists` returns one row, so it runs.
 * So does a statement without groups whose expressions may aggregate its rows: a query, an update without values, which compiles to a select, and a mutation whose `RETURNING` PostgreSQL rejects.
 */
export function isNoneStatement(node: QueryNode | RecordQueryNode | MutationNode): boolean {
  switch (node.kind) {
    case "query":
      return (
        node.filters.none === true &&
        !isAggregateQuery(node) &&
        !isExistsQuery(node) &&
        // Without rows, a query of groups has no group to aggregate.
        (node.groupBy.length > 0 ||
          !mayAggregate(node.from, node.projections, node.orderBy, node.distinctOn))
      )
    case "update":
    case "delete":
      return (
        node.filters.none === true &&
        (node.returning === undefined || !mayAggregate(node.target, node.returning, [], []))
      )
    default:
      return false
  }
}

/**
 * Tells whether a statement without groups over `source` may aggregate its rows into one row: whether its `fields`, the expressions of `orderBy`, or `keys` hold an `aggregate` node or a SQL fragment, or a query nested in them holds one that refers to a column of `source`.
 *
 * PostgreSQL assigns an aggregate whose arguments refer only to `source` to the statement, also from a nested query, and SQL fragments are not parsed, so it is conservative, as `mayAggregateSource` is.
 */
function mayAggregate(
  source: SourceNode,
  fields: readonly SelectedNode[],
  orderBy: readonly OrderNode[],
  keys: readonly ExpressionNode[],
): boolean {
  return (
    fields.some(field => fieldMayAggregate(field, source, true)) ||
    orderBy.some(order => holdsAggregate(order.expression, source, true)) ||
    keys.some(key => holdsAggregate(key, source, true))
  )
}

/** Tells whether `field` may aggregate the rows of `source`, as `holdsAggregate` tells of an expression, also of a fallback of `coalesce` of an aggregate; nested rows hold a query nested in the statement. */
function fieldMayAggregate(field: SelectedNode, source: SourceNode, own: boolean): boolean {
  if (isLiteralSelection(field)) {
    return false
  }
  if (isNestedSelection(field)) {
    return queryMayAggregate(field.query, source)
  }
  return (
    holdsAggregate(field.expression, source, own) ||
    (isAggregateProjection(field) &&
      field.fallbacks.some(fallback => holdsAggregate(fallback, source, own)))
  )
}

/**
 * Tells whether `node` may aggregate the rows of `source`: with `own`, for an expression of the statement over `source`, whether it holds an `aggregate` node or a SQL fragment, and otherwise, or in a query nested in it, whether it holds one that refers to a column of `source` or holds a query.
 */
function holdsAggregate(node: ExpressionNode, source: SourceNode, own: boolean): boolean {
  let found = false
  visitNodes(node, child => {
    if (found) {
      return
    }
    if (child.kind === "aggregate" || child.kind === "raw") {
      found = own || refersToSource(child, source)
    } else if (child.kind === "nestedQuery") {
      found = queryMayAggregate(child.query, source)
    } else if (child.kind === "inQuery" && child.query.kind === "nestedQuery") {
      found = queryMayAggregate(child.query.query, source)
    }
  })
  return found
}

/** Tells whether `node` refers to a column of `source` or holds a query, whose references `visitNodes` does not reach, so that it may refer to one. */
function refersToSource(node: ExpressionNode, source: SourceNode): boolean {
  let found = false
  visitNodes(node, child => {
    found ||=
      (child.kind === "column" && child.source === source) ||
      child.kind === "nestedQuery" ||
      (child.kind === "inQuery" && child.query.kind === "nestedQuery")
  })
  return found
}

/** Tells whether `query`, nested in a statement over `source`, holds in any clause, or in the fields that `distinctFields` keeps, an aggregate or a SQL fragment that may aggregate the rows of `source`, as `holdsAggregate` tells. */
function queryMayAggregate(query: QueryNode, source: SourceNode): boolean {
  const { filters } = query
  const expressions: (ExpressionNode | undefined)[] = [
    filters.relation,
    filters.scope,
    filters.user,
    query.having,
    query.limit,
    query.offset,
  ]
  return (
    query.projections.some(field => fieldMayAggregate(field, source, false)) ||
    (query.distinctFields?.some(field => fieldMayAggregate(field, source, false)) ?? false) ||
    expressions.some(node => node !== undefined && holdsAggregate(node, source, false)) ||
    query.groupBy.some(key => holdsAggregate(key, source, false)) ||
    query.orderBy.some(order => holdsAggregate(order.expression, source, false)) ||
    query.distinctOn.some(key => holdsAggregate(key, source, false))
  )
}
