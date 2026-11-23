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
import type { AnyType } from "../type/type"

import { deriveSeparateSource } from "./order"
import { readValue } from "./read"

/** Maximum number of arguments of a PostgreSQL function, `FUNC_MAX_ARGS` of its default build. */
const maxFunctionArguments = 100

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
  // Packing and ordering read the values of `query` through a derived source, and packing refers to each scalar twice.
  const { source, order } = deriveSeparateSource(query, many)

  // A function takes at most 100 arguments, so a wider row is an array of JSON values.
  const wide = projections.length > maxFunctionArguments
  const values: ExpressionNode[] = []
  for (const projection of projections) {
    const value = createRef(source, projection.key)
    if (projection.nested !== undefined) {
      // Nested rows are JSON already, so they stay JSON in the packed row.
      values.push(value)
    } else {
      const scalar = packScalar(value, projection.type)
      values.push(wide ? createList("to_json(", [scalar], ")") : scalar)
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
          filter: undefined,
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

/**
 * Packs a scalar of `type` as the PostgreSQL text representation that the type decodes, of the value or of the result of the read expression of the type, or `NULL`.
 *
 * `format` uses the output function of the type, as the driver receives the values of a row; a cast to `text` differs from it for types such as `boolean`, `inet`, and `char`.
 */
function packScalar(value: ColumnRefNode, type: AnyType): RawSqlNode {
  // `format` turns `NULL` into an empty string, so `NULL` is tested apart, and `IS NULL` would also hold for a composite whose fields are all `NULL`.
  // The test reads the value itself: a read expression is `NULL` only for `NULL`, so it is evaluated once.
  return createNode({
    kind: "raw",
    fragments: ["CASE WHEN ", " IS NOT DISTINCT FROM NULL THEN NULL ELSE format('%s', ", ") END"],
    values: [value, readValue(value, type)],
  })
}

function createRef(source: DerivedSourceNode, key: string): ColumnRefNode {
  return createNode({ kind: "column", source, key })
}
