import type { ExpressionNode } from "../../ast/nodes"

/**
 * Position of an operand in its parent node.
 *
 * - `value`: an operand of a comparison, `IN`, `IS NULL`, or a cast.
 * - `condition`: an operand of `AND`, `OR`, or `NOT`.
 * - `interpolation`: an expression interpolated into a SQL fragment.
 */
export type OperandPosition = "value" | "condition" | "interpolation"

/** Tells whether an operand of `kind` needs parentheses at `position`, so that the SQL keeps the structure of the tree. */
export function needsParentheses(kind: ExpressionNode["kind"], position: OperandPosition): boolean {
  switch (kind) {
    case "column":
    case "param":
    case "boolean":
    case "values":
    case "subquery":
    case "exists":
    case "aggregate":
      return false
    case "cast":
      // Text after an interpolated cast could continue its type name, such as a subscript `[1]` after `integer[]`.
      return position === "interpolation"
    case "raw":
      // An interpolated fragment stays as it is, since its text may be a list or a clause rather than a value.
      return position !== "interpolation"
    case "and":
    case "or":
      return true
    case "not":
    case "comparison":
    case "in":
    case "isNull":
      // A condition operand cannot regroup with the `AND`, `OR`, or `NOT` around it.
      return position !== "condition"
    default:
      return kind satisfies never
  }
}
