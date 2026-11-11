// Sort keys that are projections: the same value as a selected field, referred to by the position of its projection, and the derived sources of rows that are read in order, such as by an aggregate.

import type {
  DerivedSourceNode,
  ExpressionNode,
  OrderNode,
  ProjectionNode,
  RawSqlNode,
  SelectNode,
  TableSourceNode,
} from "../ast/nodes"
import { createNode } from "../ast/nodes"
import { findValueProjection } from "../ast/projections"
import { text } from "../type/builtins/text"

/** Creates the number of the projection at `position`, by which `ORDER BY` sorts by its value instead of evaluating an expression again. */
export function createPositionNode(position: number): RawSqlNode {
  return createNode({ kind: "raw", fragments: [String(position + 1)], values: [] })
}

/** Creates the order of a statement that sorts by the positions of the projections among `projections` that have the values of its sort expressions, and by the other expressions as they are. */
export function sortByPositions(
  orderBy: readonly OrderNode[],
  projections: readonly ProjectionNode[],
): readonly OrderNode[] {
  const result: OrderNode[] = []
  for (const order of orderBy) {
    const position = findValueProjection(projections, order.expression)
    result.push(
      position === -1
        ? order
        : Object.freeze({
            expression: createPositionNode(position),
            direction: order.direction,
            nulls: order.nulls,
          }),
    )
  }
  return result
}

/** Derived source of the rows of a query, and the order in which its reader takes them, such as an aggregate. */
export interface OrderedSource {
  readonly source: DerivedSourceNode
  /** Sort keys over the projections of the source, in the order of the query; empty unless the rows are read in order. */
  readonly order: readonly OrderNode[]
}

/**
 * Creates the derived source of the rows of `query`, and, when `ordered`, the order of the query over the projections of the source, in which its reader takes the rows, such as an aggregate.
 *
 * The order of a derived source does not carry into the query that reads it, so the reader sorts by sort keys: the projections that have the values of the sort expressions, as for an executed query, or projections of the sort expressions added to the source.
 * With a limit or an offset, the source sorts by the positions of the sort keys, so that the rows it chooses, their values, and their order in the reader come from one evaluation; so it does with `DISTINCT ON`, whose order chooses the first row of each group, and with a row lock, which takes the rows in the order of its query.
 * Without them, it has no order.
 * `offset` replaces the offset of `query` in the source, such as `OFFSET 0` that keeps PostgreSQL from merging it, and the source replaces the occurrence of a table `replaces` for its reader.
 */
export function deriveOrderedSource(
  query: SelectNode,
  ordered: boolean,
  offset: ExpressionNode | undefined = query.offset,
  replaces?: TableSourceNode,
): OrderedSource {
  const { orderBy } = query
  const projections = query.projections.slice()
  const sorted =
    query.limit !== undefined ||
    query.offset !== undefined ||
    query.distinctOn !== undefined ||
    query.lock !== undefined
  const sortKeys: SortKey[] = []
  const positions: OrderNode[] = []
  if (orderBy.length > 0 && (ordered || sorted)) {
    for (let index = 0; index < orderBy.length; index++) {
      const { expression, direction, nulls } = orderBy[index]!
      const position = projectSortKey(projections, expression, index)
      if (ordered) {
        sortKeys.push({ key: projections[position]!.key, direction, nulls })
      }
      if (sorted) {
        positions.push(
          Object.freeze({ expression: createPositionNode(position), direction, nulls }),
        )
      }
    }
  }
  // The order only chooses the rows of a limit, an offset, or `DISTINCT ON`, or the order of a row lock, there.
  const derivedQuery = Object.freeze({ ...query, projections, orderBy: positions, offset })
  const source: DerivedSourceNode = Object.freeze(
    replaces === undefined
      ? { kind: "derived", query: derivedQuery, lateral: false }
      : { kind: "derived", query: derivedQuery, lateral: false, replaces },
  )
  const order: OrderNode[] = []
  for (const { key, direction, nulls } of sortKeys) {
    order.push(
      Object.freeze({ expression: createNode({ kind: "column", source, key }), direction, nulls }),
    )
  }
  return { source, order }
}

/** Projection of a derived source that the reader of the source sorts by, with the direction and the placement of `NULL` of its order. */
interface SortKey extends Omit<OrderNode, "expression"> {
  readonly key: string
}

/**
 * Returns the position of the projection that sorts by `expression`: the projection of `findValueProjection`, or one added to `projections`.
 *
 * `index` is the position of the expression in the order.
 */
function projectSortKey(
  projections: ProjectionNode[],
  expression: ExpressionNode,
  index: number,
): number {
  const position = findValueProjection(projections, expression)
  if (position !== -1) {
    return position
  }
  // A sort key is never decoded, so its type `text` only completes the projection; it adds no cast, so the key keeps the SQL type of its expression.
  projections.push(
    Object.freeze({ key: createSortProjectionKey(projections, index), expression, type: text }),
  )
  return projections.length - 1
}

/** Creates the key of the sort key projection at `index` of the sort keys, which no other projection has. */
function createSortProjectionKey(projections: readonly ProjectionNode[], index: number): string {
  const base = `$order${index + 1}`
  let key = base
  for (let number = 2; projections.some(projection => projection.key === key); number++) {
    key = `${base}_${number}`
  }
  return key
}
