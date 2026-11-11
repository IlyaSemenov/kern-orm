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
import { lowerDistinctRows } from "./distinct"
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
/** Lowers an aggregate query to a statement of the value of its aggregate over the rows that its filters, limit, and offset choose, also the distinct rows of `distinct` and the first rows of `distinctOn`. */
export function lowerAggregate(node: QueryNode, context: LoweringContext): SelectNode<SourceNode> {
  // The only projection of an aggregate query is the projection of the aggregate.
  const field = node.projections[0] as AggregateProjection
  const aggregate = field.expression
  // The projection of `count(*)` is replaced when a fallback is added, while its call stays.
  const counted = aggregate === countProjection.expression
  let from: SourceNode = node.from
  let filters = noFilters
  let args = aggregate.arguments
  let order = noOrder
  // Statement of the rows that the aggregate reads from a derived source, and the key of the projection of its first argument there.
  let rows: SelectNode | undefined
  let valueKey: string | undefined
  if (node.distinctFields !== undefined) {
    // `count(*)` reads no values of the rows, and the number of the rows does not depend on their order.
    const distinctRows = lowerDistinctRows(
      node,
      context,
      counted ? undefined : aggregate.arguments[0],
      !counted,
    )
    rows = distinctRows.query
    valueKey = distinctRows.valueKey
  } else {
    const orderBy = lowerOrder(node.orderBy, context)
    const groupBy = lowerKeys(node.groupBy, context)
    filters = lowerFilters(node.filters, context)
    args = lowerEach(aggregate.arguments, context, lowerExpression)
    order = field.ordered ? orderBy : noOrder
    // An aggregate takes the rows before the limit and the offset of its own query, so it reads the rows of a page from a derived source of them.
    // PostgreSQL assigns an aggregate to the innermost query whose sources its arguments refer to, so an argument that refers only to the sources of enclosing queries, such as a column of the parent row, is read from a derived source as well, whose column the aggregate takes.
    // It aggregates the groups of a query of groups, one row each, as such a source reads them.
    if (
      groupBy !== undefined ||
      node.limit !== undefined ||
      node.offset !== undefined ||
      (!counted && !refersToSource(args[0]!, node.from))
    ) {
      const projections: ScalarProjection[] = []
      if (!counted) {
        // The source names the value of the first argument by the key of its projection, whose type is never decoded there.
        valueKey = "value"
        projections.push(Object.freeze({ key: valueKey, expression: args[0]!, type: field.type }))
      }
      rows = {
        kind: "select",
        from: node.from,
        joins: noJoins,
        projections,
        filters,
        groupBy,
        having: lowerValue(node.having, context),
        // `count(*)` reads no values of the rows, and the number of the rows of a page does not depend on their order.
        orderBy: counted ? noOrder : orderBy,
        limit: node.limit,
        offset: node.offset,
        rows: "many",
        value: false,
        guaranteedBy: undefined,
      }
    }
  }
  if (rows !== undefined) {
    const derived = deriveOrderedSource(rows, field.ordered)
    from = derived.source
    filters = noFilters
    if (valueKey !== undefined) {
      // The arguments after the first are parameters that do not depend on the row, so they stay in the call.
      const sourceArgs: ExpressionNode[] = [
        createNode({ kind: "column", source: from, key: valueKey }),
      ]
      for (let index = 1; index < args.length; index++) {
        sourceArgs.push(args[index]!)
      }
      args = sourceArgs
    }
    order = derived.order
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
    case "fragment":
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
