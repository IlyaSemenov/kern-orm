// Lowering of the expressions of a statement and of the clauses of a query that hold them, which replaces each query in an expression with its SQL.

import type {
  ExpressionNode,
  NestedQueryNode,
  OrderNode,
  ProjectionNode,
  QueryFilters,
  SelectNode,
} from "../ast/nodes"
import { createNode } from "../ast/nodes"
import { isExistsQuery } from "../query/exists"
import type { QueryNode, SqlSelectedNode } from "../query/node"
import { isNestedSelection } from "../query/node"

import type { LoweringContext } from "./context"
import { checkDb } from "./context"

/**
 * Lowers an expression, replacing each query in it and checking the query as a nested query.
 * A query of `exists`, such as in a condition, becomes `EXISTS` of its rows, another query of one value a scalar subquery of its value, the query of the values of `IN` its statement, and another query in SQL text its statement in parentheses.
 *
 * It returns `node` itself when it holds no query, and creates only the nodes that hold one.
 */
export function lowerExpression(node: ExpressionNode, context: LoweringContext): ExpressionNode {
  switch (node.kind) {
    case "column":
    case "param":
    case "boolean":
    case "values":
    case "tableName":
    // Only lowering creates the queries of subqueries and of `EXISTS`, which are lowered already.
    case "subquery":
    case "exists":
    case "textSubquery":
      return node
    case "nestedQuery":
      return lowerNestedQuery(node, context)
    case "cast": {
      const operand = lowerExpression(node.operand, context)
      return operand === node.operand
        ? node
        : createNode({ kind: "cast", operand, type: node.type })
    }
    case "not": {
      const operand = lowerExpression(node.operand, context)
      return operand === node.operand ? node : createNode({ kind: "not", operand })
    }
    case "isNull": {
      const operand = lowerExpression(node.operand, context)
      return operand === node.operand ? node : createNode({ kind: "isNull", operand })
    }
    case "and":
    case "or": {
      const operands = lowerEach(node.operands, context, lowerExpression)
      return operands === node.operands ? node : createNode({ kind: node.kind, operands })
    }
    case "comparison": {
      const left = lowerExpression(node.left, context)
      const right = lowerExpression(node.right, context)
      return left === node.left && right === node.right
        ? node
        : createNode({ kind: "comparison", operator: node.operator, left, right })
    }
    case "in": {
      const operand = lowerExpression(node.operand, context)
      const list = lowerEach(node.list, context, lowerExpression)
      return operand === node.operand && list === node.list
        ? node
        : createNode({ kind: "in", operand, list })
    }
    case "inQuery": {
      const operand = lowerExpression(node.operand, context)
      const query =
        node.query.kind === "nestedQuery" ? lowerQueryOfValues(node.query, context) : node.query
      return operand === node.operand && query === node.query
        ? node
        : createNode({ kind: "inQuery", operand, query })
    }
    case "raw": {
      const values = lowerEach(node.values, context, lowerExpression)
      return values === node.values
        ? node
        : createNode({ kind: "raw", fragments: node.fragments, values })
    }
    case "aggregate": {
      const args = lowerEach(node.arguments, context, lowerExpression)
      const orderBy = lowerOrder(node.orderBy, context)
      const filter = lowerValue(node.filter, context)
      return args === node.arguments && orderBy === node.orderBy && filter === node.filter
        ? node
        : createNode({
            kind: "aggregate",
            name: node.name,
            distinct: node.distinct,
            arguments: args,
            orderBy,
            filter,
          })
    }
    default:
      return node satisfies never
  }
}

/** Lowers an optional expression, such as `having` of a query or a value of a row of an insert, as `lowerExpression` does. */
export function lowerValue(
  node: ExpressionNode | undefined,
  context: LoweringContext,
): ExpressionNode | undefined {
  return node === undefined ? undefined : lowerExpression(node, context)
}

/**
 * Lowers a query in an expression to `EXISTS` of the rows of a query of `exists`, to a scalar subquery of the value of another query of one value, or to its statement in parentheses for a query of records or of rows `many`, which only SQL text holds.
 *
 * In SQL text, a query of `exists` stays `EXISTS` rather than a subquery of its value, so that PostgreSQL can join its rows in a condition, as a semi-join.
 */
function lowerNestedQuery(node: NestedQueryNode, context: LoweringContext): ExpressionNode {
  checkDb(node.db, context, "A query in an expression")
  const { query } = node
  if (isExistsQuery(query)) {
    return context.lowerExists(query)
  }
  return createNode({
    kind: query.value && query.rows !== "many" ? "subquery" : "textSubquery",
    query: context.lowerSelect(query, sortsByPositions(query)),
  })
}

/** Lowers the query of the values of `IN` to its statement, whatever its rows; it tells positions as `sortsByPositions` does. */
function lowerQueryOfValues(node: NestedQueryNode, context: LoweringContext): SelectNode {
  checkDb(node.db, context, "A query in an expression")
  return context.lowerSelect(node.query, sortsByPositions(node.query))
}

/** Tells whether the statement of `node` in a subquery sorts by the positions of its projections: PostgreSQL finds a sort expression of `SELECT DISTINCT` or `GROUP BY` only when it is equal to a selected one or a key, and the keys of `DISTINCT ON` with the order only when they are equal, while a repeated expression has aliases of its own and, apart from the parameters of casts in a query of groups, parameters of its own. */
function sortsByPositions(node: QueryNode): boolean {
  return node.distinct || node.distinctOn.length > 0 || node.groupBy.length > 0
}

/** Lowers the filters of a query, replacing the queries in their expressions; without queries, it returns `filters` itself. */
export function lowerFilters(filters: QueryFilters, context: LoweringContext): QueryFilters {
  const { relation, scope, user } = filters
  const loweredRelation = relation === undefined ? undefined : lowerExpression(relation, context)
  const loweredScope = scope === undefined ? undefined : lowerExpression(scope, context)
  const loweredUser = user === undefined ? undefined : lowerExpression(user, context)
  if (loweredRelation === relation && loweredScope === scope && loweredUser === user) {
    return filters
  }
  const lowered: { -readonly [K in keyof QueryFilters]: QueryFilters[K] } = {}
  if (loweredRelation !== undefined) {
    lowered.relation = loweredRelation
  }
  if (loweredScope !== undefined) {
    lowered.scope = loweredScope
  }
  if (loweredUser !== undefined) {
    lowered.user = loweredUser
  }
  return Object.freeze(lowered)
}

/**
 * Lowers the sort keys of a query, replacing the queries in their expressions; without queries, it returns `orderBy` itself.
 *
 * Each sort key is lowered by `lowerSelectedValue` over `selected`, the fields of the query, and `projections`, their lowered projections.
 */
export function lowerOrder(
  orderBy: readonly OrderNode[],
  context: LoweringContext,
  selected?: readonly SqlSelectedNode[],
  projections?: readonly ProjectionNode[],
): readonly OrderNode[] {
  let lowered: OrderNode[] | undefined
  for (let index = 0; index < orderBy.length; index++) {
    const order = orderBy[index]!
    const { expression } = order
    const sorted = lowerSelectedValue(expression, context, selected, projections)
    if (lowered === undefined && sorted === expression) {
      continue
    }
    lowered ??= orderBy.slice(0, index)
    lowered.push(
      sorted === expression
        ? order
        : Object.freeze({ expression: sorted, direction: order.direction, nulls: order.nulls }),
    )
  }
  return lowered ?? orderBy
}

/**
 * Lowers the keys of `groupBy` or `distinctOn` of a query, or `undefined` for a query without them.
 *
 * Each key is lowered by `lowerSelectedValue` over `selected`, the fields of the query, and `projections`, their lowered projections.
 */
export function lowerKeys(
  keys: readonly ExpressionNode[],
  context: LoweringContext,
  selected?: readonly SqlSelectedNode[],
  projections?: readonly ProjectionNode[],
): readonly ExpressionNode[] | undefined {
  return keys.length === 0
    ? undefined
    : lowerEach(keys, context, (key, keyContext) =>
        lowerSelectedValue(key, keyContext, selected, projections),
      )
}

/**
 * Lowers `expression`, a sort key, a key of a group, or the argument of an aggregate: the value of a field of `selected` gets the expression of its lowered projection among `projections`, and another expression is lowered as it is.
 *
 * Lowering a field that holds a query gives its projection a new node, so reusing that node keeps the projection identifiable by its position.
 * A field of an aggregate or of `exists` is identified by the node of its reference, which holds the field.
 */
export function lowerSelectedValue(
  expression: ExpressionNode,
  context: LoweringContext,
  selected?: readonly SqlSelectedNode[],
  projections?: readonly ProjectionNode[],
): ExpressionNode {
  const position =
    selected === undefined || projections === undefined || projections === selected
      ? -1
      : selected.findIndex(field => isFieldValue(field, expression))
  return position === -1 ? lowerExpression(expression, context) : projections![position]!.expression
}

/** Tells whether `expression`, a sort key, a key of a group, or the argument of an aggregate, is the value of `field`: its expression, or for a field of an aggregate or of `exists`, the node of its reference in the callback of `orderBy` or `groupBy`. */
function isFieldValue(field: SqlSelectedNode, expression: ExpressionNode): boolean {
  return isNestedSelection(field)
    ? expression.kind === "nestedQuery" && expression.field === field
    : field.expression === expression
}

/** Lowers each of `items` with `lower`; when none changes, it returns `items` itself. */
export function lowerEach<T>(
  items: readonly T[],
  context: LoweringContext,
  lower: (item: T, context: LoweringContext) => T,
): readonly T[] {
  let lowered: T[] | undefined
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!
    const result = lower(item, context)
    if (lowered !== undefined) {
      lowered.push(result)
    } else if (result !== item) {
      lowered = items.slice(0, index)
      lowered.push(result)
    }
  }
  return lowered ?? items
}
