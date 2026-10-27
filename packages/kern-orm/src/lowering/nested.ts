// Packs the rows of a nested query as positional JSON arrays in one value of the row of its parent, which result decoding reads by the result plan of the nested query.

import type {
  ColumnRefNode,
  DerivedSourceNode,
  ExpressionNode,
  OrderNode,
  ProjectionNode,
  RawSqlNode,
  SelectNode,
} from "../ast/nodes"
import { createNode, createSelectNode } from "../ast/nodes"
import type { NestedField, ResultPlan } from "../result/result"
import { text } from "../type/builtins/text"

import { createPositionNode, findSortProjection } from "./order"

/** Maximum number of arguments of a PostgreSQL function, `FUNC_MAX_ARGS` of its default build. */
const maxFunctionArguments = 100

/** Number `0`, the offset that keeps PostgreSQL from merging a derived source into its query. */
const zeroNode = /* @__PURE__ */ createNode<RawSqlNode>({
  kind: "raw",
  fragments: ["0"],
  values: [],
})

// A scalar subquery in the select list rather than a LATERAL join: PostgreSQL evaluates it after the sort and the limit of the parent, while it evaluates a LATERAL join for every row before them.
/**
 * Creates the projection of the rows of `query` packed as JSON under `key`, selected as a scalar subquery and decoded by the result plan of `query`.
 *
 * Rows `many` are one array, and the other rows modes are one packed row or `NULL` without a row; a scalar subquery fails with several rows.
 */
export function projectRows(key: string, query: SelectNode): ProjectionNode {
  const packed = packRows(query)
  const { nested } = packed.projections[0] as NestedField
  return Object.freeze({ key, expression: createNode({ kind: "subquery", query: packed }), nested })
}

/**
 * Creates a query whose only projection is the rows of `query` packed as JSON, a field decoded by the result plan of `query`.
 *
 * Rows `many` are packed as an array in the order of `query`, and the created query returns one row.
 * Otherwise the created query returns a packed row for each row of `query`, so a scalar subquery of it gives the packed row, `NULL` without a row, and fails with several rows.
 */
export function packRows(query: SelectNode): SelectNode {
  const { projections, orderBy } = query
  const many = query.rows === "many"
  // Packing and ordering read the values of `query` through a derived source, whose expressions are evaluated once per row unless PostgreSQL merges it into the created query.
  const innerProjections = projections.slice()
  const paginated = query.limit !== undefined || query.offset !== undefined
  // The order of a derived source does not carry into an aggregate, so the aggregate sorts by projections of the derived source.
  const sortKeys: SortKey[] = []
  // A limit or an offset chooses the rows by the positions of the same projections, so the rows, their values, and their order in the aggregate come from one evaluation.
  const positions: OrderNode[] = []
  if (orderBy.length > 0 && (many || paginated)) {
    for (let index = 0; index < orderBy.length; index++) {
      const { expression, direction, nulls } = orderBy[index]!
      const position = projectSortKey(innerProjections, expression, index)
      if (many) {
        sortKeys.push({ key: innerProjections[position]!.key, direction, nulls })
      }
      if (paginated) {
        positions.push(
          Object.freeze({ expression: createPositionNode(position), direction, nulls }),
        )
      }
    }
  }
  // PostgreSQL merges no derived source with a limit, an offset, or a volatile function in its select list.
  // Packing refers to each scalar twice, so `OFFSET 0` keeps it from merging a source that selects scalars other than table columns, which it would evaluate twice.
  const separate =
    !paginated &&
    projections.some(
      projection => projection.nested === undefined && !isTableColumn(projection.expression),
    )
  const source: DerivedSourceNode = Object.freeze({
    kind: "derived",
    query: Object.freeze({
      ...query,
      projections: innerProjections,
      // The order only chooses the rows of a limit or an offset there.
      orderBy: positions,
      offset: separate ? zeroNode : query.offset,
    }),
    lateral: false,
  })

  // A function takes at most 100 arguments, so a wider row is an array of JSON values.
  const wide = projections.length > maxFunctionArguments
  const values: ExpressionNode[] = []
  for (const projection of projections) {
    const value = createRef(source, projection.key)
    if (projection.nested !== undefined) {
      // Nested rows are JSON already, so they stay JSON in the packed row.
      values.push(value)
    } else {
      values.push(wide ? createList("to_json(", [packScalar(value)], ")") : packScalar(value))
    }
  }
  // Without values, a packed row is `[]`, a row without fields, which differs from a missing row.
  const row = wide
    ? createList("array_to_json(ARRAY[", values, "])")
    : createList("json_build_array(", values, ")")

  let packed: ExpressionNode = row
  if (many) {
    const aggregateOrder: OrderNode[] = []
    for (const { key, direction, nulls } of sortKeys) {
      aggregateOrder.push(Object.freeze({ expression: createRef(source, key), direction, nulls }))
    }
    // `json_agg` gives `NULL` without rows.
    packed = createNode<RawSqlNode>({
      kind: "raw",
      fragments: ["coalesce(", ", '[]'::json)"],
      values: [
        createNode({
          kind: "aggregate",
          name: "json_agg",
          arguments: [row],
          orderBy: aggregateOrder,
        }),
      ],
    })
  }

  const plan: ResultPlan = Object.freeze({
    fields: projections,
    rows: query.rows,
    value: query.value,
  })
  const projection: ProjectionNode = Object.freeze({
    key: "rows",
    expression: packed,
    nested: plan,
  })
  return createSelectNode(source, [projection])
}

/** Projection of a derived source that an aggregate sorts by, with the direction and the placement of `NULL` of its order. */
interface SortKey extends Omit<OrderNode, "expression"> {
  readonly key: string
}

/** Tells whether `node` is a column of a table, which PostgreSQL reads rather than evaluates, so it can be repeated. */
function isTableColumn(node: ExpressionNode): boolean {
  return node.kind === "column" && node.source.kind === "table"
}

/**
 * Returns the position of the projection that sorts by `expression`: the projection of `findSortProjection`, or one added to `projections`.
 *
 * `index` is the position of the expression in the order.
 */
function projectSortKey(
  projections: ProjectionNode[],
  expression: ExpressionNode,
  index: number,
): number {
  const position = findSortProjection(projections, expression)
  if (position !== -1) {
    return position
  }
  // A sort key is never decoded, so its type `text` only completes the projection; it adds no cast, so the key keeps the SQL type of its expression.
  projections.push(
    Object.freeze({ key: createSortProjectionKey(projections, index), expression, type: text }),
  )
  return projections.length - 1
}

/**
 * Packs a scalar as its PostgreSQL text representation, or `NULL`.
 *
 * `format` uses the output function of the type, as the driver receives the values of a row; a cast to `text` differs from it for types such as `boolean`, `inet`, and `char`.
 */
function packScalar(value: ColumnRefNode): RawSqlNode {
  // `format` turns `NULL` into an empty string, so `NULL` is tested apart, and `IS NULL` would also hold for a composite whose fields are all `NULL`.
  return createNode({
    kind: "raw",
    fragments: ["CASE WHEN ", " IS NOT DISTINCT FROM NULL THEN NULL ELSE format('%s', ", ") END"],
    values: [value, value],
  })
}

/** Creates SQL of `items` separated by commas between `prefix` and `suffix`, such as the arguments of a function call. */
function createList(prefix: string, items: readonly ExpressionNode[], suffix: string): RawSqlNode {
  if (items.length === 0) {
    return createNode({ kind: "raw", fragments: [prefix + suffix], values: [] })
  }
  const fragments = [prefix]
  for (let index = 1; index < items.length; index++) {
    fragments.push(", ")
  }
  fragments.push(suffix)
  return createNode({ kind: "raw", fragments, values: items })
}

function createRef(source: DerivedSourceNode, key: string): ColumnRefNode {
  return createNode({ kind: "column", source, key })
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
