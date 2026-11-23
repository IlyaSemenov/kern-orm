// Read expressions of types: where a statement selects a value by the expression of its type, whose result the type decodes, as a field of its result.

import type {
  ColumnRefNode,
  ExpressionNode,
  ProjectionNode,
  ScalarProjection,
  SelectNode,
  SourceNode,
  UnfrozenSelectNode,
} from "../ast/nodes"
import { createNode, noFilters, noJoins } from "../ast/nodes"
import type { AnyType } from "../type/type"

import { deriveSeparateSource } from "./order"

/** Returns `value`, the expression of a result that `type` decodes, read by the read expression of the type, or `value` itself for a type without one. */
export function readValue(value: ExpressionNode, type: AnyType): ExpressionNode {
  return type.read === undefined ? value : createNode({ kind: "read", operand: value, type })
}

/**
 * Returns `fields`, the projections of the result of a statement, such as its select list or its `RETURNING`, with each scalar of a type with a read expression read by it, or `fields` itself without such a scalar.
 *
 * Nested rows are JSON, whose scalars packing reads.
 */
export function readFields(fields: readonly ProjectionNode[]): readonly ProjectionNode[] {
  let read: ProjectionNode[] | undefined
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index]!
    if (!isReadField(field)) {
      read?.push(field)
      continue
    }
    read ??= fields.slice(0, index)
    read.push(
      Object.freeze({
        key: field.key,
        expression: readValue(field.expression, field.type),
        type: field.type,
      }),
    )
  }
  return read ?? fields
}

/**
 * Returns the statement of the rows of `statement`, an executed query that sorts by its sort expressions, with the fields of types with read expressions read by them, or `statement` itself without such a field.
 *
 * A field read by its expression is not the projection that has the value of a sort expression or of a key, so the statement sorts and groups by the expression itself, such as a column, rather than by the position of the field.
 * A statement whose clauses take the value of such a field from its projection, as `takesReadField` tells, reads its rows from a derived source of the values, over which it reads the fields and sorts by the sort keys of the source, since the order of a derived source does not carry into the query that reads it.
 */
export function readRows(
  statement: UnfrozenSelectNode<SourceNode>,
): UnfrozenSelectNode<SourceNode> {
  // A statement without such a field, as most are, is checked once.
  if (!statement.projections.some(isReadField)) {
    return statement
  }
  if (!takesReadField(statement)) {
    statement.projections = readFields(statement.projections)
    return statement
  }
  // The statement reads a sorted field at two places, as its value and as its sort key.
  const { source, order } = deriveSeparateSource(statement, true)
  const read: ProjectionNode[] = []
  for (const field of statement.projections) {
    const { key } = field
    const value = createNode<ColumnRefNode>({ kind: "column", source, key })
    read.push(
      Object.freeze(
        field.nested === undefined
          ? { key, expression: readValue(value, field.type), type: field.type }
          : { key, expression: value, nested: field.nested },
      ),
    )
  }
  return {
    kind: "select",
    from: source,
    joins: noJoins,
    projections: read,
    filters: noFilters,
    orderBy: order,
    limit: undefined,
    offset: undefined,
    rows: statement.rows,
    value: statement.value,
    guaranteedBy: statement.guaranteedBy,
    recordTemplate: statement.recordTemplate,
  }
}

/** Scalar projection of a type with a read expression. */
type ReadField = ScalarProjection & {
  readonly type: { readonly read: (value: string) => string }
}

/** Tells whether `field` is a scalar of a type with a read expression, which a result reads by it. */
function isReadField(field: ProjectionNode): field is ReadField {
  return field.nested === undefined && field.type.read !== undefined
}

/**
 * Tells whether a clause of `statement`, which has a field of a type with a read expression, takes the value of such a field from the projection of the field, so that the statement cannot read the field in its select list:
 *
 * - `DISTINCT` compares the projections, and PostgreSQL takes a sort key of it only from them.
 * - A sort key, a key of a group, or a key of `DISTINCT ON` that is the expression of the field refers to the projection by its position, since repeating an expression other than a column would evaluate it again, with parameters of its own, which PostgreSQL does not take for a key.
 */
function takesReadField(statement: SelectNode): boolean {
  if (statement.distinct) {
    return true
  }
  const { orderBy, groupBy, distinctOn } = statement
  for (const field of statement.projections) {
    if (!isReadField(field)) {
      continue
    }
    const { expression } = field
    if (
      expression.kind !== "column" &&
      (orderBy.some(order => order.expression === expression) ||
        groupBy?.includes(expression) ||
        distinctOn?.includes(expression))
    ) {
      return true
    }
  }
  return false
}
