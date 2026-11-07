// Lowering of an aggregate query to the statement of its aggregate over the rows that the query chooses.

import type {
  AggregateNode,
  ExpressionNode,
  ScalarProjection,
  SelectNode,
  SourceNode,
} from "../ast/nodes"
import { createList, createNode, noFilters, noJoins, noOrder } from "../ast/nodes"
import type { AggregateProjection } from "../query/aggregate"
import { countProjection } from "../query/aggregate"
import type { QueryNode } from "../query/node"

import type { LoweringContext } from "./context"
import {
  lowerEach,
  lowerExpression,
  lowerFilters,
  lowerKeys,
  lowerOrder,
  lowerValue,
} from "./expression"
import { deriveOrderedSource } from "./order"

// PostgreSQL rejects sorting by a column beside an aggregate, so the statement has no order: the order only chooses the rows of a page and orders the input of an ordered aggregate.
/** Lowers an aggregate query to a statement of the value of its aggregate over the rows that its filters, limit, and offset choose. */
export function lowerAggregate(node: QueryNode, context: LoweringContext): SelectNode<SourceNode> {
  // The only projection of an aggregate query is the projection of the aggregate.
  const field = node.projections[0] as AggregateProjection
  const aggregate = field.expression
  const orderBy = lowerOrder(node.orderBy, context)
  let from: SourceNode = node.from
  const groupBy = lowerKeys(node.groupBy, context)
  let filters = lowerFilters(node.filters, context)
  let args = lowerEach(aggregate.arguments, context, lowerExpression)
  let order = field.ordered ? orderBy : noOrder
  // The projection of `count(*)` is replaced when a fallback is added, while its call stays.
  const counted = aggregate === countProjection.expression
  // An aggregate takes the rows before the limit and the offset of its own query, so it reads the rows of a page from a derived source of them.
  // PostgreSQL assigns an aggregate to the innermost query whose sources its arguments refer to, so an argument that refers only to the sources of enclosing queries, such as a column of the parent row, is read from a derived source as well, whose column the aggregate takes.
  // It aggregates the groups of a query of groups, one row each, as such a source reads them.
  if (
    groupBy !== undefined ||
    node.limit !== undefined ||
    node.offset !== undefined ||
    (!counted && !refersToSource(args[0]!, node.from))
  ) {
    // `count(*)` reads no values of the rows, and the number of the rows of a page does not depend on their order.
    const projections: ScalarProjection[] = []
    if (!counted) {
      // The source names the value of the first argument by the key of its projection, whose type is never decoded there.
      projections.push(Object.freeze({ key: "value", expression: args[0]!, type: field.type }))
    }
    const rows = deriveOrderedSource(
      {
        kind: "select",
        from: node.from,
        joins: noJoins,
        projections,
        filters,
        groupBy,
        having: lowerValue(node.having, context),
        orderBy: counted ? noOrder : orderBy,
        limit: node.limit,
        offset: node.offset,
        rows: "many",
        value: false,
        guaranteedBy: undefined,
      },
      field.ordered,
    )
    from = rows.source
    filters = noFilters
    if (!counted) {
      // The arguments after the first are parameters that do not depend on the row, so they stay in the call.
      const sourceArgs: ExpressionNode[] = [
        createNode({ kind: "column", source: from, key: "value" }),
      ]
      for (let index = 1; index < args.length; index++) {
        sourceArgs.push(args[index]!)
      }
      args = sourceArgs
    }
    order = rows.order
  }
  const call: AggregateNode =
    args === aggregate.arguments && order.length === 0
      ? aggregate
      : createNode({
          kind: "aggregate",
          name: aggregate.name,
          distinct: aggregate.distinct,
          arguments: args,
          orderBy: order,
          filter: aggregate.filter,
        })
  const fallbacks = lowerEach(field.fallbacks, context, lowerExpression)
  let value: ExpressionNode = call
  if (fallbacks.length > 0) {
    const values: ExpressionNode[] = [call]
    for (const fallback of fallbacks) {
      values.push(fallback)
    }
    value = createList("coalesce(", values, ")")
  }
  return Object.freeze({
    kind: "select",
    from,
    joins: noJoins,
    projections: [
      value === aggregate
        ? field
        : Object.freeze({ key: field.key, expression: value, type: field.type }),
    ],
    filters,
    orderBy: noOrder,
    limit: undefined,
    offset: undefined,
    rows: node.rows,
    value: true,
    guaranteedBy: undefined,
  })
}

/**
 * Tells whether `node` refers to `source` outside the queries nested in it.
 *
 * A reference inside a nested query is not counted, so an argument that refers to the source only there is read from a derived source, which is correct either way.
 */
function refersToSource(node: ExpressionNode, source: SourceNode): boolean {
  switch (node.kind) {
    case "column":
      return node.source === source
    case "param":
    case "boolean":
    case "values":
    case "nestedQuery":
    case "tableName":
    case "subquery":
    case "exists":
    case "textSubquery":
      return false
    case "cast":
    case "not":
    case "isNull":
    case "inQuery":
      return refersToSource(node.operand, source)
    case "and":
    case "or":
      return node.operands.some(operand => refersToSource(operand, source))
    case "comparison":
      return refersToSource(node.left, source) || refersToSource(node.right, source)
    case "in":
      return (
        refersToSource(node.operand, source) || node.list.some(item => refersToSource(item, source))
      )
    case "raw":
      return node.values.some(value => refersToSource(value, source))
    case "aggregate":
      // PostgreSQL assigns an aggregate to a query by the sources of its arguments and its filter.
      return (
        node.arguments.some(argument => refersToSource(argument, source)) ||
        (node.filter !== undefined && refersToSource(node.filter, source))
      )
    default:
      return node satisfies never
  }
}
