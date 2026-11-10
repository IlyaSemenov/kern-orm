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
 * PostgreSQL assigns an aggregate whose arguments and filter refer only to the sources of an enclosing query to that query, also through a query nested in them ([PostgreSQL](https://www.postgresql.org/docs/current/sql-expressions.html#SYNTAX-AGGREGATES)), so such a call in a nested query, such as `sum` of a column of the parent row, aggregates the rows of the query of `source`.
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

/**
 * Tells whether an aggregate belongs to an enclosing query rather than the query of `source`.
 *
 * Only references free in its arguments, order, and filter decide its owner: columns bound by a subquery do not count, but references through that subquery to its enclosing queries do.
 * Without such references, an aggregate of constants belongs to the query that contains it.
 * The node must have been lowered, so that subqueries expose their sources.
 */
export function aggregatesOuterSource(node: ExpressionNode, source: SourceNode): boolean {
  let local = false
  let outer = false
  const queries: SelectNode[] = []
  visitNodes(
    node,
    child => {
      if (child.kind !== "column" || local) return
      for (const query of queries) {
        if (bindsSource(query.from, child.source)) return
        for (const join of query.joins) {
          if (bindsSource(join.source, child.source)) return
        }
      }
      if (child.source === source) local = true
      else outer = true
    },
    queries,
  )
  return outer && !local
}

/** Tells whether a declared source binds a reference, including the table occurrence a derived source replaces. */
function bindsSource(declared: SourceNode | undefined, source: SourceNode): boolean {
  return declared === source || (declared?.kind === "derived" && declared.replaces === source)
}

/**
 * Calls `visit` for `node` and each expression node in it at any depth, including the queries nested in it.
 * When supplied, `queries` holds the nested queries enclosing each node passed to `visit`.
 */
function visitNodes(
  node: ExpressionNode,
  visit: (node: ExpressionNode) => void,
  queries?: SelectNode[],
): void {
  visit(node)
  switch (node.kind) {
    case "column":
    case "param":
    case "boolean":
    case "fragment":
    case "tableName":
    // `where` resolves an object of column values, and lowering replaces a query in an expression, before a statement compiles them.
    case "values":
    case "nestedQuery":
      return
    case "cast":
    case "not":
    case "isNull":
      visitNodes(node.operand, visit, queries)
      return
    case "and":
    case "or":
      for (const operand of node.operands) {
        visitNodes(operand, visit, queries)
      }
      return
    case "comparison":
      visitNodes(node.left, visit, queries)
      visitNodes(node.right, visit, queries)
      return
    case "in":
      visitNodes(node.operand, visit, queries)
      for (const item of node.list) {
        visitNodes(item, visit, queries)
      }
      return
    case "inQuery":
      visitNodes(node.operand, visit, queries)
      if (node.query.kind === "select") {
        visitQuery(node.query, visit, queries)
      }
      return
    case "raw":
      for (const value of node.values) {
        visitNodes(value, visit, queries)
      }
      return
    case "subquery":
    case "exists":
    case "textSubquery":
      visitQuery(node.query, visit, queries)
      return
    case "aggregate":
      for (const argument of node.arguments) {
        visitNodes(argument, visit, queries)
      }
      for (const order of node.orderBy) {
        visitNodes(order.expression, visit, queries)
      }
      if (node.filter !== undefined) {
        visitNodes(node.filter, visit, queries)
      }
      return
    default:
      node satisfies never
  }
}

/**
 * Calls `visit` for each expression node in the clauses and the derived sources of `query` at any depth.
 * When supplied, `queries` holds the nested queries enclosing each node passed to `visit`; this call adds `query` for its duration.
 */
function visitQuery(
  query: SelectNode,
  visit: (node: ExpressionNode) => void,
  queries?: SelectNode[],
): void {
  queries?.push(query)
  const { from, filters } = query
  if (from?.kind === "derived") {
    visitQuery(from.query, visit, queries)
  }
  for (const join of query.joins) {
    if (join.source.kind === "derived") {
      visitQuery(join.source.query, visit, queries)
    }
    visitNodes(join.on, visit, queries)
  }
  if (query.distinctOn !== undefined) {
    for (const key of query.distinctOn) {
      visitNodes(key, visit, queries)
    }
  }
  for (const projection of query.projections) {
    visitNodes(projection.expression, visit, queries)
  }
  if (filters.relation !== undefined) {
    visitNodes(filters.relation, visit, queries)
  }
  if (filters.scope !== undefined) {
    visitNodes(filters.scope, visit, queries)
  }
  if (filters.user !== undefined) {
    visitNodes(filters.user, visit, queries)
  }
  if (query.groupBy !== undefined) {
    for (const key of query.groupBy) {
      visitNodes(key, visit, queries)
    }
  }
  if (query.having !== undefined) {
    visitNodes(query.having, visit, queries)
  }
  for (const order of query.orderBy) {
    visitNodes(order.expression, visit, queries)
  }
  if (query.limit !== undefined) {
    visitNodes(query.limit, visit, queries)
  }
  if (query.offset !== undefined) {
    visitNodes(query.offset, visit, queries)
  }
  queries?.pop()
}
