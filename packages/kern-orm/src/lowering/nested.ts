// Packs the rows of a nested query as positional JSON arrays in one value of the row of its parent, which result decoding reads by the result plan of the nested query.

import type {
  ColumnRefNode,
  DerivedSourceNode,
  ExpressionNode,
  ProjectionNode,
  RawSqlNode,
  SelectNode,
} from "../ast/nodes"
import { createList, createNode, createSelectNode } from "../ast/nodes"
import type { NestedField, ResultPlan } from "../result/result"

import { deriveOrderedSource } from "./order"

/** Maximum number of arguments of a PostgreSQL function, `FUNC_MAX_ARGS` of its default build. */
const maxFunctionArguments = 100

/** Number `0`, the offset that keeps PostgreSQL from merging a derived source into its query. */
const zeroNode = /* @__PURE__ */ createNode<RawSqlNode>({
  kind: "raw",
  fragments: ["0"],
  values: [],
})

// A scalar subquery in the select list rather than a LATERAL join: with a limit, PostgreSQL evaluates it after the sort of the parent and stops once it has the rows of the limit, while it evaluates a LATERAL join for every row before them.
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
  const { projections } = query
  const many = query.rows === "many"
  // Packing and ordering read the values of `query` through a derived source, whose expressions are evaluated once per row unless PostgreSQL merges it into the created query.
  // PostgreSQL merges no derived source with `DISTINCT`, a row lock, a limit, an offset, or a volatile function in its select list.
  // Packing refers to each scalar twice, so `OFFSET 0` keeps it from merging a source that selects scalars other than table columns, which it would evaluate twice.
  const separate =
    !query.distinct &&
    query.lock === undefined &&
    query.limit === undefined &&
    query.offset === undefined &&
    projections.some(
      projection => projection.nested === undefined && !isTableColumn(projection.expression),
    )
  const { source, order } = deriveOrderedSource(query, many, separate ? zeroNode : query.offset)

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
    // `json_agg` gives `NULL` without rows.
    packed = createNode<RawSqlNode>({
      kind: "raw",
      fragments: ["coalesce(", ", '[]'::json)"],
      values: [
        createNode({
          kind: "aggregate",
          name: "json_agg",
          distinct: false,
          arguments: [row],
          orderBy: order,
        }),
      ],
    })
  }

  const plan: ResultPlan = Object.freeze({
    fields: projections,
    rows: query.rows,
    value: query.value,
    guaranteedBy: query.guaranteedBy,
    recordTemplate: query.recordTemplate,
    conversion: query.conversion,
  })
  const projection: ProjectionNode = Object.freeze({
    key: "rows",
    expression: packed,
    nested: plan,
  })
  return createSelectNode(source, [projection])
}

/** Tells whether `node` is a column of a table, which PostgreSQL reads rather than evaluates, so it can be repeated. */
function isTableColumn(node: ExpressionNode): boolean {
  return node.kind === "column" && node.source.kind === "table"
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

function createRef(source: DerivedSourceNode, key: string): ColumnRefNode {
  return createNode({ kind: "column", source, key })
}
