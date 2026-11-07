// Lowering of the fields of a query or of RETURNING to projections, which selects the value of each nested query in place of its field.

import type { ProjectionNode, ScalarProjection, SelectNode } from "../ast/nodes"
import { createNode } from "../ast/nodes"
import { isSelectedAsValue } from "../query/aggregate"
import { isExistsQuery } from "../query/exists"
import type { QueryNode, SelectedNode, SqlSelectedNode } from "../query/node"
import { isLiteralSelection, isNestedSelection } from "../query/node"
import type { RecordTemplateField } from "../result/result"

import type { LoweringContext } from "./context"
import { checkDb } from "./context"
import { lowerExists, lowerExpression } from "./expression"
import { projectRows } from "./nested"

/**
 * Lowers the fields of a query to projections, packing the rows of each nested query into the value of its field, or selecting the value of an aggregate query or `EXISTS` of a query of `exists`, and replacing the queries in the expressions of the other fields; checks them as `lowerQuery` does.
 *
 * Without queries, it returns `selected` itself.
 */
export function lowerProjections(
  selected: readonly SqlSelectedNode[],
  context: LoweringContext,
): readonly ProjectionNode[] {
  let lowered: ProjectionNode[] | undefined
  for (let index = 0; index < selected.length; index++) {
    const field = selected[index]!
    let projection: ProjectionNode
    if (isNestedSelection(field)) {
      checkDb(field.db, context, `Selected field "${field.key}"`)
      projection = projectQuery(field.key, field.query, context)
    } else {
      const expression = lowerExpression(field.expression, context)
      // Only lowering adds projections of nested rows, so the field is scalar.
      projection =
        expression === field.expression
          ? field
          : Object.freeze({ key: field.key, expression, type: (field as ScalarProjection).type })
    }
    if (lowered !== undefined) {
      lowered.push(projection)
    } else if (projection !== field) {
      lowered = selected.slice(0, index) as ProjectionNode[]
      lowered.push(projection)
    }
  }
  return lowered ?? (selected as readonly ProjectionNode[])
}

/** Creates the projection of the value of `node`, a nested query, under `key`: `EXISTS` of a query of `exists`, the value of an aggregate query, or the packed rows of another query or of one whose result code converts. */
function projectQuery(key: string, node: QueryNode, context: LoweringContext): ProjectionNode {
  if (!isSelectedAsValue(node)) {
    return projectRows(key, context.lowerSelect(node, false))
  }
  return isExistsQuery(node)
    ? projectExists(key, node, context)
    : projectAggregateValue(key, context.lowerSelect(node, false))
}

/** Creates the projection of `EXISTS` of the rows of `node`, a query of `exists`, under `key`, decoded by the type of the projection of `exists`. */
export function projectExists(
  key: string,
  node: QueryNode,
  context: LoweringContext,
): ProjectionNode {
  return Object.freeze({
    key,
    expression: lowerExists(node, context),
    type: (node.projections[0] as ScalarProjection).type,
  })
}

// An aggregate query always returns one row of one value, so its value needs no packing.
/** Creates the projection of the value of `query`, the statement of an aggregate query, under `key`, selected as a scalar subquery and decoded by the type of the aggregate. */
function projectAggregateValue(key: string, query: SelectNode): ProjectionNode {
  return Object.freeze({
    key,
    expression: createNode({ kind: "subquery", query }),
    type: (query.projections[0] as ScalarProjection).type,
  })
}

/** Returns the fields of `selected` that a statement selects, or `selected` itself without literals. */
export function dropLiterals(selected: readonly SelectedNode[]): readonly SqlSelectedNode[] {
  if (!selected.some(isLiteralSelection)) {
    return selected as readonly SqlSelectedNode[]
  }
  const fields: SqlSelectedNode[] = []
  for (const field of selected) {
    if (!isLiteralSelection(field)) {
      fields.push(field)
    }
  }
  return fields
}

/** Creates the template of the records of `selected`: every field in its order with the value of a literal, or `undefined` without literals. */
export function createRecordTemplate(
  selected: readonly SelectedNode[],
): readonly RecordTemplateField[] | undefined {
  if (!selected.some(isLiteralSelection)) {
    return undefined
  }
  const template: RecordTemplateField[] = []
  for (const field of selected) {
    template.push(
      Object.freeze({
        key: field.key,
        value: isLiteralSelection(field) ? field.literal : undefined,
      }),
    )
  }
  return template
}
