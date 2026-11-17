import type { BinaryNode, ExpressionNode } from "../../ast/nodes"

/**
 * Position of an operand in its parent node.
 *
 * - `value`: an operand of a comparison, `IN`, or `IS NULL`.
 * - `cast`: the operand of a cast.
 * - `condition`: an operand of `AND`, `OR`, or `NOT`.
 * - `interpolation`: an expression interpolated into a SQL fragment.
 * - `BinaryPosition`: an operand of a binary operator.
 */
export type OperandPosition = "value" | "cast" | "condition" | "interpolation" | BinaryPosition

/** Position of an operand of a binary operator: the precedence of the operator, and whether the operand is on its right. */
export interface BinaryPosition {
  readonly precedence: number
  readonly right: boolean
}

/** Positions of the left and the right operand of a binary operator. */
export interface BinaryPositions {
  readonly left: BinaryPosition
  readonly right: BinaryPosition
}

// One object for each precedence, so that compiling an operator allocates no position.
const positionsByPrecedence: readonly BinaryPositions[] = [
  { left: { precedence: 1, right: false }, right: { precedence: 1, right: true } },
  { left: { precedence: 2, right: false }, right: { precedence: 2, right: true } },
  { left: { precedence: 3, right: false }, right: { precedence: 3, right: true } },
  { left: { precedence: 4, right: false }, right: { precedence: 4, right: true } },
]

/** Returns the positions of the operands of a binary operator by its precedence. */
export function getBinaryPositions(operator: BinaryNode["operator"]): BinaryPositions {
  return positionsByPrecedence[getPrecedence(operator) - 1]!
}

// PostgreSQL binds `^` tighter than `*`, `/`, and `%`, these tighter than `+` and `-`, these tighter than any other operator, such as `||`, and all of them tighter than comparisons, `IN`, and `IS`, but looser than a cast; operators of one precedence group from the left.
/** Returns the precedence of a binary operator in PostgreSQL, higher for an operator that binds tighter. */
function getPrecedence(operator: BinaryNode["operator"]): number {
  switch (operator) {
    case "^":
      return 4
    case "*":
    case "/":
    case "%":
      return 3
    case "+":
    case "-":
      return 2
    default:
      return 1
  }
}

/** Tells whether an operand `node` needs parentheses at `position`, so that the SQL keeps the structure of the tree. */
export function needsParentheses(node: ExpressionNode, position: OperandPosition): boolean {
  const { kind } = node
  switch (kind) {
    case "column":
    case "param":
    case "boolean":
    case "values":
    case "nestedQuery":
    case "tableName":
    case "subquery":
    case "exists":
    case "textSubquery":
    case "aggregate":
      return false
    case "cast":
      // Text after an interpolated cast could continue its type name, such as a subscript `[1]` after `integer[]`.
      return position === "interpolation"
    case "raw":
    case "fragment":
      // An interpolated fragment stays as it is, since its text may be a list or a clause rather than a value.
      return position !== "interpolation"
    case "and":
    case "or":
      return true
    case "not":
    case "comparison":
    case "in":
    case "inQuery":
    case "isNull":
      // A condition operand cannot regroup with the `AND`, `OR`, or `NOT` around it.
      return position !== "condition"
    case "binary":
      return needsBinaryParentheses(node.operator, position)
    default:
      return kind satisfies never
  }
}

function needsBinaryParentheses(
  operator: BinaryNode["operator"],
  position: OperandPosition,
): boolean {
  switch (position) {
    case "value":
      return false
    case "cast":
    case "condition":
    case "interpolation":
      return true
    default: {
      const precedence = getPrecedence(operator)
      return (
        precedence < position.precedence || (precedence === position.precedence && position.right)
      )
    }
  }
}
