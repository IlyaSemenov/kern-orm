import { combineNodes, negateNode } from "../ast/boolean"
import type { ColumnRefNode, ExpressionNode, TableSourceNode } from "../ast/nodes"
import { createNode } from "../ast/nodes"
import { createIsNullNode, isExpression, toExpression, toNode } from "../expression/expression"
import { compareNodes } from "../expression/operators/comparison"
import { findColumn } from "../table/table"
import type { AnyType } from "../type/type"

/**
 * Replaces objects of column values in a predicate with conditions on the columns of `source`.
 *
 * Groups are rebuilt, so constants that appear after resolution, such as an empty object, are simplified.
 */
export function resolveValues(node: ExpressionNode, source: TableSourceNode): ExpressionNode {
  switch (node.kind) {
    case "values": {
      const conditions: ExpressionNode[] = []
      for (const key of Object.keys(node.values)) {
        const value = node.values[key]
        const type = findColumn(source.table, key)?.type
        const column = createNode({ kind: "column", source, key })
        if (value === null) {
          conditions.push(createIsNullNode(column))
        } else if (type) {
          conditions.push(matchValue(source, column, type, value))
        } else {
          // The compiler rejects a key that is not a column of the table.
          conditions.push(compareNodes("=", column, value, undefined))
        }
      }
      return combineNodes("and", conditions)
    }
    case "and":
    case "or": {
      const operands: ExpressionNode[] = []
      for (const operand of node.operands) {
        operands.push(resolveValues(operand, source))
      }
      return combineNodes(node.kind, operands)
    }
    case "not":
      return negateNode(resolveValues(node.operand, source))
    case "raw":
      return createNode({
        ...node,
        values: node.values.map(value => resolveValues(value, source)),
      })
    default:
      return node
  }
}

/** Matches a column with a value of an object condition by calling the `eq` operator of its type, whichever operator it is. */
function matchValue(
  source: TableSourceNode,
  column: ColumnRefNode,
  type: AnyType,
  value: unknown,
): ExpressionNode {
  const expression = toExpression(column, type) as { eq?: unknown }
  if (typeof expression.eq !== "function") {
    throw new TypeError(
      `Column "${column.key}" of table "${source.table.name}" has no eq operator; an object condition can only match it with null`,
    )
  }
  const predicate: unknown = expression.eq(value)
  if (!isExpression(predicate)) {
    throw new TypeError(
      `The eq operator of column "${column.key}" of table "${source.table.name}" must return an expression`,
    )
  }
  return toNode(predicate)
}
