// Statement of a query that evaluates its nested queries only over the rows of its page, which it reads from a derived source.

import type {
  ExpressionNode,
  OrderNode,
  ProjectionNode,
  QueryFilters,
  ScalarProjection,
  SelectNode,
  SourceNode,
} from "../ast/nodes"
import { createNode, noFilters, noJoins } from "../ast/nodes"
import { findValueProjection } from "../ast/projections"
import { collectColumnKeys, mayAggregateSource } from "../ast/references"
import type { QueryNode, SqlSelectedNode } from "../query/node"
import { isNestedSelection } from "../query/node"
import type { RecordTemplateField } from "../result/result"
import { text } from "../type/builtins/text"

import { deriveOrderedSource, sortByPositions } from "./order"

/**
 * Lowers `node` with `projections`, `filters`, `orderBy`, `groupBy`, `having`, and `distinctOn`, the lowered parts of the node, to a statement that evaluates its nested queries, apart from those that it sorts by, groups by, or compares, over the rows of a derived page, or returns `undefined` for a query that keeps its page on its table.
 * `queryFields` are the fields of the query without literals, and `projections` their lowered projections in the same order.
 * The derived source applies `DISTINCT ON`, the filters, the keys and the condition of the groups, the order, the limit, and the offset, and replaces the occurrence of the table.
 * It selects each key of `distinctOn` that it does not select otherwise, so that it has a select list, which PostgreSQL requires with `DISTINCT ON`, and evaluates each key once; a key of `groupBy` needs no projection of its own, since it compiles as the position of a projection that has its value or as its expression.
 *
 * A query keeps its page on its table without an offset and `distinctOn`, without nested queries that the page would evaluate over its rows, or when `mayAggregateSource` tells that such a nested query may aggregate the rows of the query, which the limit and the offset apply after.
 *
 * The source selects the columns of the table that the fields and the nested queries of the query read, under their keys, and the other scalar fields of the query, which it evaluates before the limit and the offset as the query would, such as a window function over all its rows or an aggregate of a group.
 * A field of an aggregate or of `exists` that the query sorts by or that is a key is such a scalar field: the order and the keys need its value for every row.
 * A column that no field reads stays out of the source, which could not select it beside an aggregate of a SQL fragment, such as `count(*)`.
 * The order of a derived source does not carry into the query that reads it, so the statement sorts the rows of the page again by the sort keys of the source, by positions when `positions` is set.
 */
export function lowerPage(
  node: QueryNode,
  queryFields: readonly SqlSelectedNode[],
  projections: readonly ProjectionNode[],
  filters: QueryFilters,
  orderBy: readonly OrderNode[],
  groupBy: readonly ExpressionNode[] | undefined,
  having: ExpressionNode | undefined,
  distinctOn: readonly ExpressionNode[] | undefined,
  positions: boolean,
  guaranteedBy: string | undefined,
  recordTemplate: readonly RecordTemplateField[] | undefined,
): SelectNode<SourceNode> | undefined {
  // PostgreSQL evaluates the select list also for the rows that an offset skips, so the nested queries of a page after an offset read its rows from a derived source.
  // Without a limit, it evaluates the select list of `DISTINCT ON` also for the rows after the first of each group, so the nested queries of a query of `distinctOn` read its first rows from a derived source too.
  // A query of `distinct` compares the values of all its fields to choose the rows of the page, so it evaluates them for every row anyway.
  // A query with a row lock stays on its table too, since PostgreSQL evaluates the select list below the lock there, whereas a derived page would lock its rows before the nested queries that read them lock theirs.
  if (
    (node.offset === undefined && distinctOn === undefined) ||
    node.distinct ||
    node.lock !== undefined ||
    !queryFields.some((field, index) =>
      isPagedField(field, projections[index]!, orderBy, groupBy, distinctOn),
    )
  ) {
    return undefined
  }
  const { from } = node
  const columnKeys = new Set<string>()
  const fields: ScalarProjection[] = []
  // Keys of the source of the scalar fields other than columns of the table, by the position of the field, which no column key takes.
  const fieldKeys: (string | undefined)[] = []
  for (let index = 0; index < projections.length; index++) {
    const { expression } = projections[index]!
    let key: string | undefined
    if (isPagedField(queryFields[index]!, projections[index]!, orderBy, groupBy, distinctOn)) {
      if (mayAggregateSource(expression, from)) {
        return undefined
      }
      collectColumnKeys(expression, from, columnKeys)
    } else if (expression.kind === "column" && expression.source === from) {
      columnKeys.add(expression.key)
    } else {
      key = `$field${index + 1}`
      // A projection of the source is never decoded, so its type `text` only completes it.
      fields.push(Object.freeze({ key, expression, type: text }))
    }
    fieldKeys.push(key)
  }
  const sourced: ScalarProjection[] = []
  for (const key of columnKeys) {
    sourced.push(
      Object.freeze({
        key,
        expression: createNode({ kind: "column", source: from, key }),
        type: text,
      }),
    )
  }
  for (const field of fields) {
    sourced.push(field)
  }
  if (distinctOn !== undefined) {
    for (let index = 0; index < distinctOn.length; index++) {
      const key = distinctOn[index]!
      if (findValueProjection(sourced, key) === -1) {
        sourced.push(Object.freeze({ key: `$key${index + 1}`, expression: key, type: text }))
      }
    }
  }
  const page = deriveOrderedSource(
    {
      kind: "select",
      from,
      joins: noJoins,
      projections: sourced,
      filters,
      groupBy,
      having,
      orderBy,
      limit: node.limit,
      offset: node.offset,
      distinctOn,
      rows: "many",
      value: false,
      guaranteedBy: undefined,
    },
    true,
    node.offset,
    from,
  )
  const selected: ProjectionNode[] = []
  for (let index = 0; index < projections.length; index++) {
    const projection = projections[index]!
    const key = fieldKeys[index]
    selected.push(
      key === undefined
        ? projection
        : Object.freeze({
            key: projection.key,
            expression: createNode({ kind: "column", source: page.source, key }),
            type: (projection as ScalarProjection).type,
          }),
    )
  }
  return Object.freeze({
    kind: "select",
    from: page.source,
    joins: noJoins,
    projections: selected,
    filters: noFilters,
    orderBy: positions ? sortByPositions(page.order, selected) : page.order,
    limit: undefined,
    offset: undefined,
    rows: node.rows,
    value: node.value,
    guaranteedBy,
    recordTemplate,
  })
}

/**
 * Tells whether `field`, a field of a query lowered to `projection`, is a nested query that a derived page evaluates only over its rows: one that no sort key of `orderBy`, the lowered order, sorts by, and that is none of `groupBy` and `distinctOn`, the lowered keys of the query.
 *
 * The query evaluates a field that it sorts by, groups by, or compares, of an aggregate or of `exists`, for every row anyway.
 */
function isPagedField(
  field: SqlSelectedNode,
  projection: ProjectionNode,
  orderBy: readonly OrderNode[],
  groupBy: readonly ExpressionNode[] | undefined,
  distinctOn: readonly ExpressionNode[] | undefined,
): boolean {
  if (!isNestedSelection(field)) {
    return false
  }
  const { expression } = projection
  return (
    !orderBy.some(order => order.expression === expression) &&
    (groupBy === undefined || !groupBy.includes(expression)) &&
    (distinctOn === undefined || !distinctOn.includes(expression))
  )
}
