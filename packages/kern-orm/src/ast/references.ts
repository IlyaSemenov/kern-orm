// Column references of SQL AST nodes at any depth, including the queries nested in them.

import type { ExpressionNode, SelectNode, SourceNode } from "./nodes"

/** Adds to `keys` the key of each column reference to `source` in `node` at any depth, including the queries nested in it. */
export function collectColumnKeys(
  node: ExpressionNode,
  source: SourceNode,
  keys: Set<string>,
): void {
  visitNodes(node, true, child => {
    if (child.kind === "column" && child.source === source) {
      keys.add(child.key)
    }
  })
}

/**
 * Tells whether `node` holds, at any depth, a SQL fragment that refers to a column of `source` outside the queries nested in the fragment.
 *
 * PostgreSQL assigns an aggregate whose arguments refer only to the sources of an enclosing query to that query ([PostgreSQL](https://www.postgresql.org/docs/current/sql-expressions.html#SYNTAX-AGGREGATES)).
 * Lowering does not parse SQL fragments to identify their aggregates, so such a fragment in a nested query, such as `sum` of a column of the parent row, may aggregate the rows of the query of `source`.
 */
export function holdsFragmentOfSource(node: ExpressionNode, source: SourceNode): boolean {
  let found = false
  visitNodes(node, true, child => {
    if (found || child.kind !== "raw") {
      return
    }
    visitNodes(child, false, value => {
      if (value.kind === "column" && value.source === source) {
        found = true
      }
    })
  })
  return found
}

/** Calls `visit` for `node` and each expression node in it, also in the queries nested in it when `deep` is set. */
function visitNodes(
  node: ExpressionNode,
  deep: boolean,
  visit: (node: ExpressionNode) => void,
): void {
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
      visitNodes(node.operand, deep, visit)
      return
    case "and":
    case "or":
      for (const operand of node.operands) {
        visitNodes(operand, deep, visit)
      }
      return
    case "comparison":
      visitNodes(node.left, deep, visit)
      visitNodes(node.right, deep, visit)
      return
    case "in":
      visitNodes(node.operand, deep, visit)
      for (const item of node.list) {
        visitNodes(item, deep, visit)
      }
      return
    case "inQuery":
      visitNodes(node.operand, deep, visit)
      if (deep && node.query.kind === "select") {
        visitQuery(node.query, visit)
      }
      return
    case "raw":
      for (const value of node.values) {
        visitNodes(value, deep, visit)
      }
      return
    case "subquery":
    case "exists":
      if (deep) {
        visitQuery(node.query, visit)
      }
      return
    case "aggregate":
      for (const argument of node.arguments) {
        visitNodes(argument, deep, visit)
      }
      for (const order of node.orderBy) {
        visitNodes(order.expression, deep, visit)
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
    visitNodes(join.on, true, visit)
  }
  for (const projection of query.projections) {
    visitNodes(projection.expression, true, visit)
  }
  if (filters.relation !== undefined) {
    visitNodes(filters.relation, true, visit)
  }
  if (filters.scope !== undefined) {
    visitNodes(filters.scope, true, visit)
  }
  if (filters.user !== undefined) {
    visitNodes(filters.user, true, visit)
  }
  for (const order of query.orderBy) {
    visitNodes(order.expression, true, visit)
  }
  if (query.limit !== undefined) {
    visitNodes(query.limit, true, visit)
  }
  if (query.offset !== undefined) {
    visitNodes(query.offset, true, visit)
  }
}
