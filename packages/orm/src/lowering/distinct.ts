// Rows of a query of distinct or distinctOn: the checks of a query that SQL cannot give the rows of, which reject it wherever it is, and the statement of the rows that an aggregate or exists reads.

import type {
  ExpressionNode,
  OrderNode,
  ProjectionNode,
  ScalarProjection,
  SelectNode,
  TableSourceNode,
} from "../ast/nodes"
import { noJoins, noOrder } from "../ast/nodes"
import { findValueProjection, isSameValue } from "../ast/projections"
import { isSelectedAsValue } from "../query/aggregate"
import type { QueryNode, SqlSelectedNode } from "../query/node"
import { isNestedSelection } from "../query/node"
import { text } from "../type/builtins/text"

import type { LoweringContext } from "./context"
import { lowerFilters, lowerKeys, lowerOrder, lowerSelectedValue, lowerValue } from "./expression"
import { dropLiterals, lowerProjections } from "./projection"

/**
 * Rejects a query of `distinct` of the lowered `projections` and `orderBy` that `SELECT DISTINCT` cannot give the rows of, with an error that does not depend on where the query is:
 *
 * - A query without projections, such as of only literals, has nothing to compare, and PostgreSQL has no syntax for it.
 * - Nested rows are JSON, which PostgreSQL cannot compare.
 * - PostgreSQL rejects a sort key that is not a projection, since duplicates can differ in its value, whereas a packed query would add it to the projections of its derived source and compare it too.
 *   Only a projection of the same column or of the same expression node is sure to have its value, as in `findValueProjection`.
 */
export function checkDistinct(
  projections: readonly ProjectionNode[],
  orderBy: readonly OrderNode[],
): void {
  if (projections.length === 0) {
    throw new Error(
      "distinct requires at least one selected column or SQL expression; literal fields are not compared",
    )
  }
  for (const { key, nested } of projections) {
    if (nested !== undefined) {
      throw new Error(`distinct cannot compare the nested rows of the selected field "${key}"`)
    }
  }
  for (const { expression } of orderBy) {
    if (findValueProjection(projections, expression) === -1) {
      throw new Error(
        "A query of distinct sorts only by its selected fields, since duplicates can differ in any other value; select the value to sort by it",
      )
    }
  }
}

/**
 * Rejects a query of `distinctOn` of the lowered `projections`, `keys`, and `orderBy` that `SELECT DISTINCT ON` cannot give the rows of, with an error that does not depend on where the query is: a query without projections, such as of only literals, since PostgreSQL requires a select list with `DISTINCT ON`, and an order that `checkDistinctOnOrder` rejects.
 */
export function checkDistinctOn(
  projections: readonly ProjectionNode[],
  keys: readonly ExpressionNode[],
  orderBy: readonly OrderNode[],
): void {
  if (projections.length === 0) {
    throw new Error(
      "distinctOn requires at least one selected column or SQL expression; literal fields are not selected",
    )
  }
  checkDistinctOnOrder(projections, keys, orderBy)
}

/**
 * Rejects an order of a query of `distinctOn` of the lowered `projections`, `keys`, and `orderBy` that sorts by a value other than the keys before it sorts by all of them, in any order and direction, which PostgreSQL rejects, since the order sorts the groups apart and then chooses the first row of each; an order of only keys may omit some, which PostgreSQL adds.
 *
 * A sort key is a key when it is the same column, or the same expression node that a projection of the query has, as `findValueProjection` tells, so that both compile to the same column or position.
 * Another expression may compile at each place with parameters and aliases of its own, so PostgreSQL may find the two unequal; the check runs before packing, which would add the expression to the projections of its derived source and make both positions, so that it counts as another value wherever the query is.
 */
function checkDistinctOnOrder(
  projections: readonly ProjectionNode[],
  keys: readonly ExpressionNode[],
  orderBy: readonly OrderNode[],
): void {
  const isKey = (key: ExpressionNode, expression: ExpressionNode) =>
    isSameValue(key, expression) &&
    (key.kind === "column" || findValueProjection(projections, key) !== -1)
  let leading = 0
  while (leading < orderBy.length && keys.some(key => isKey(key, orderBy[leading]!.expression))) {
    leading++
  }
  if (leading === orderBy.length) {
    return
  }
  for (const key of keys) {
    let sorted = false
    for (let index = 0; index < leading && !sorted; index++) {
      sorted = isKey(key, orderBy[index]!.expression)
    }
    if (!sorted) {
      throw new Error(
        "A query of distinctOn must sort by all its keys before any other value; sort by a key of an expression through its selected field",
      )
    }
  }
}

/** Statement of the rows of a query of `distinct` or `distinctOn` that an aggregate or `EXISTS` reads. */
export interface DistinctRows {
  readonly query: SelectNode<TableSourceNode>
  /** Key of the projection of the argument of the aggregate among the projections of `query`, or `undefined` without an argument. */
  readonly valueKey: string | undefined
}

/**
 * Lowers the rows of `node`, a query of `distinct` or `distinctOn` made by an aggregate method or `exists`, to the statement that gives them, which an aggregate reads from a derived source and `EXISTS` reads as it is.
 *
 * It lowers the fields that the query kept, its keys, its order, and `argument`, the first argument of the aggregate, through those fields, as `lowerSelectedValue` does, so that each value of a selected field is its projection, and checks the query as the statement of the query of those fields is checked, except that a query of `distinctOn` needs no selected field, since the statement selects its keys.
 *
 * - The statement of `distinct` selects the fields, which `DISTINCT` compares, and `argument` must be one of them, as a sort key must be, since duplicates can differ in any other value.
 * - The statement of `distinctOn` selects `argument` and each key that it does not select otherwise, so that it has a select list, which PostgreSQL requires with `DISTINCT ON`.
 *   It selects no other field, since an aggregate reads the rows of the source rather than of the select list, as for a query without `distinctOn`, so it does not lower the fields of nested rows, which neither a key nor a sort key reads.
 *
 * The statement has the order of the query when `sorted` is set; the number of the rows, which `count(*)` and `EXISTS` read, does not depend on it.
 */
export function lowerDistinctRows(
  node: QueryNode,
  context: LoweringContext,
  argument: ExpressionNode | undefined,
  sorted: boolean,
): DistinctRows {
  const fields = dropLiterals(node.distinctFields!)
  let selected = fields
  if (!node.distinct) {
    // A field of an aggregate or of `exists` is a scalar, which a key or a sort key reads.
    const scalars: SqlSelectedNode[] = []
    for (const field of fields) {
      if (!isNestedSelection(field) || isSelectedAsValue(field.query)) {
        scalars.push(field)
      }
    }
    selected = scalars
  }
  const projections = lowerProjections(selected, context)
  const orderBy = lowerOrder(node.orderBy, context, selected, projections)
  const groupBy = lowerKeys(node.groupBy, context, selected, projections)
  const keys = lowerKeys(node.distinctOn, context, selected, projections)
  const value =
    argument === undefined
      ? undefined
      : lowerSelectedValue(argument, context, selected, projections)
  let sourced: readonly ProjectionNode[]
  let valueKey: string | undefined
  // A query without keys of `distinctOn` is a query of `distinct`.
  if (keys === undefined) {
    checkDistinct(projections, orderBy)
    sourced = projections
    if (value !== undefined) {
      const position = findValueProjection(projections, value)
      if (position === -1) {
        throw new Error(
          "An aggregate of a query of distinct reads only its selected fields, since duplicates can differ in any other value; select the value to aggregate it",
        )
      }
      valueKey = projections[position]!.key
    }
  } else {
    checkDistinctOnOrder(projections, keys, orderBy)
    // A projection of the source is never decoded, so its type `text` only completes it.
    const keyed: ScalarProjection[] = []
    if (value !== undefined) {
      valueKey = "value"
      keyed.push(Object.freeze({ key: valueKey, expression: value, type: text }))
    }
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index]!
      if (findValueProjection(keyed, key) === -1) {
        keyed.push(Object.freeze({ key: `$key${index + 1}`, expression: key, type: text }))
      }
    }
    sourced = keyed
  }
  return {
    query: Object.freeze({
      kind: "select",
      from: node.from,
      joins: noJoins,
      projections: sourced,
      filters: lowerFilters(node.filters, context),
      groupBy,
      having: lowerValue(node.having, context),
      orderBy: sorted ? orderBy : noOrder,
      limit: node.limit,
      offset: node.offset,
      distinct: node.distinct,
      distinctOn: keys,
      rows: "many",
      value: false,
      guaranteedBy: undefined,
    }),
    valueKey,
  }
}
