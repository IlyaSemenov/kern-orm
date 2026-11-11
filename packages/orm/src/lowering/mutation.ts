// Lowering of a mutation to its INSERT, UPDATE, or DELETE statement.

import type {
  AssignmentNode,
  ConflictNode,
  ExpressionNode,
  MutationStatementNode,
} from "../ast/nodes"
import type { MutationNode } from "../query/node"

import type { LoweringContext } from "./context"
import { lowerEach, lowerExpression, lowerFilters, lowerValue } from "./expression"
import { createRecordTemplate, dropLiterals, lowerProjections } from "./projection"

/** Lowers a mutation to its statement, replacing the queries in its expressions, and packing the rows of each nested query of `RETURNING` into the value of its field, or selecting the value of a nested aggregate query, as a select list does. */
export function lowerMutation(node: MutationNode, context: LoweringContext): MutationStatementNode {
  const { target, returning, rows, value, conversion } = node
  const recordTemplate = returning === undefined ? undefined : createRecordTemplate(returning)
  const lowered =
    returning === undefined ? undefined : lowerProjections(dropLiterals(returning), context)
  switch (node.kind) {
    case "insert": {
      const values = lowerEach(node.values, context, lowerRow)
      const conflict = lowerConflict(node.conflict, context)
      // Without queries and literals, the fields are already projections and the node is the statement.
      if (lowered === returning && values === node.values && conflict === node.conflict) {
        return node as MutationStatementNode
      }
      return Object.freeze({
        kind: "insert",
        target,
        columns: node.columns,
        values,
        conflict,
        returning: lowered,
        recordTemplate,
        conversion,
        rows,
        value,
      })
    }
    case "update": {
      const set = lowerEach(node.set, context, lowerAssignment)
      const filters = lowerFilters(node.filters, context)
      if (lowered === returning && set === node.set && filters === node.filters) {
        return node as MutationStatementNode
      }
      return Object.freeze({
        kind: "update",
        target,
        set,
        filters,
        returning: lowered,
        recordTemplate,
        conversion,
        rows,
        value,
      })
    }
    case "delete": {
      const filters = lowerFilters(node.filters, context)
      if (lowered === returning && filters === node.filters) {
        return node as MutationStatementNode
      }
      return Object.freeze({
        kind: "delete",
        target,
        filters,
        returning: lowered,
        recordTemplate,
        conversion,
        rows,
        value,
      })
    }
    default:
      return node satisfies never
  }
}

/** Lowers a row of `VALUES` of an insert, whose `undefined` stands for `DEFAULT`. */
function lowerRow(
  row: readonly (ExpressionNode | undefined)[],
  context: LoweringContext,
): readonly (ExpressionNode | undefined)[] {
  return lowerEach(row, context, lowerValue)
}

/** Lowers the values of `DO UPDATE` of `ON CONFLICT` of an insert, keeping a conflict without queries in them as it is. */
function lowerConflict(
  conflict: ConflictNode | undefined,
  context: LoweringContext,
): ConflictNode | undefined {
  if (conflict?.update === undefined) {
    return conflict
  }
  const { target, update } = conflict
  const set = lowerEach(update.set, context, lowerAssignment)
  return set === update.set
    ? conflict
    : Object.freeze({ target, update: Object.freeze({ set, excluded: update.excluded }) })
}

function lowerAssignment(assignment: AssignmentNode, context: LoweringContext): AssignmentNode {
  const value = lowerExpression(assignment.value, context)
  return value === assignment.value ? assignment : Object.freeze({ key: assignment.key, value })
}
