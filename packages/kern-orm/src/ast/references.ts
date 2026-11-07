// Column references of SQL AST nodes at any depth, including the queries nested in them.

import type { ExpressionNode, SelectNode, SourceNode } from "./nodes"

/** Adds to `keys` the key of each column reference to `source` in `node` at any depth, including the queries nested in it. */
export function collectColumnKeys(
  node: ExpressionNode,
  source: SourceNode,
  keys: Set<string>,
): void {
  visitNodes(node, child => {
    if (child.kind === "column" && child.source === source) {
      keys.add(child.key)
    }
  })
}

/**
 * Tells whether `node` holds, at any depth, what may aggregate the rows of the query of `source`: an `aggregate` node or a SQL fragment that refers to a column of `source` at any depth, also in the queries nested in it.
 *
 * PostgreSQL assigns an aggregate whose arguments refer only to the sources of an enclosing query to that query, also through a query nested in an argument ([PostgreSQL](https://www.postgresql.org/docs/current/sql-expressions.html#SYNTAX-AGGREGATES)), so such a call in a nested query, such as `sum` of a column of the parent row, aggregates the rows of the query of `source`.
 * Lowering does not parse SQL fragments to identify their aggregates, so a fragment counts as such a call.
 *
 * It is conservative: an aggregate whose arguments read both `source` and its own query belongs to its own query, yet it counts, since this walk cannot tell a source of the query that holds the aggregate from one of an enclosing query.
 * So does a scalar fragment, also one that reads `source` only through a query correlated with it, such as of a relation.
 */
export function mayAggregateSource(node: ExpressionNode, source: SourceNode): boolean {
  let found = false
  const check = (value: ExpressionNode) => {
    if (value.kind === "column" && value.source === source) {
      found = true
    }
  }
  visitNodes(node, child => {
    if (!found && (child.kind === "aggregate" || child.kind === "raw")) {
      visitNodes(child, check)
    }
  })
  return found
}

/** Calls `visit` for `node` and each expression node in it at any depth, including the queries nested in it. */
function visitNodes(node: ExpressionNode, visit: (node: ExpressionNode) => void): void {
  visit(node)
  switch (node.kind) {
    case "column":
    case "param":
    case "boolean":
    case "tableName":
    // `where` resolves an object of column values, and lowering replaces a query in an expression, before a statement compiles them.
    case "values":
    case "nestedQuery":
      return
    case "cast":
    case "not":
    case "isNull":
      visitNodes(node.operand, visit)
      return
    case "and":
    case "or":
      for (const operand of node.operands) {
        visitNodes(operand, visit)
      }
      return
    case "comparison":
      visitNodes(node.left, visit)
      visitNodes(node.right, visit)
      return
    case "in":
      visitNodes(node.operand, visit)
      for (const item of node.list) {
        visitNodes(item, visit)
      }
      return
    case "inQuery":
      visitNodes(node.operand, visit)
      if (node.query.kind === "select") {
        visitQuery(node.query, visit)
      }
      return
    case "raw":
      for (const value of node.values) {
        visitNodes(value, visit)
      }
      return
    case "subquery":
    case "exists":
    case "textSubquery":
      visitQuery(node.query, visit)
      return
    case "aggregate":
      for (const argument of node.arguments) {
        visitNodes(argument, visit)
      }
      for (const order of node.orderBy) {
        visitNodes(order.expression, visit)
      }
      return
    default:
      node satisfies never
  }
}

/** Calls `visit` for each expression node in the clauses and the derived sources of `query` at any depth. */
function visitQuery(query: SelectNode, visit: (node: ExpressionNode) => void): void {
  const { from, filters } = query
  if (from?.kind === "derived") {
    visitQuery(from.query, visit)
  }
  for (const join of query.joins) {
    if (join.source.kind === "derived") {
      visitQuery(join.source.query, visit)
    }
    visitNodes(join.on, visit)
  }
  for (const projection of query.projections) {
    visitNodes(projection.expression, visit)
  }
  if (filters.relation !== undefined) {
    visitNodes(filters.relation, visit)
  }
  if (filters.scope !== undefined) {
    visitNodes(filters.scope, visit)
  }
  if (filters.user !== undefined) {
    visitNodes(filters.user, visit)
  }
  if (query.groupBy !== undefined) {
    for (const key of query.groupBy) {
      visitNodes(key, visit)
    }
  }
  if (query.having !== undefined) {
    visitNodes(query.having, visit)
  }
  for (const order of query.orderBy) {
    visitNodes(order.expression, visit)
  }
  if (query.limit !== undefined) {
    visitNodes(query.limit, visit)
  }
  if (query.offset !== undefined) {
    visitNodes(query.offset, visit)
  }
}
