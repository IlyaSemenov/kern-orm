import type { ExpressionNode } from "./nodes"
import { createNode, falseNode, trueNode } from "./nodes"

// Constant operands are simplified only with identities valid in SQL three-valued logic.

/** Combines predicate nodes with `AND` or `OR`, flattening nested groups of the same kind. */
export function combineNodes(kind: "and" | "or", operands: ExpressionNode[]): ExpressionNode {
  // The neutral element is dropped; the absorbing element absorbs the whole group.
  const neutral = kind === "and"
  const flat: ExpressionNode[] = []
  for (const operand of operands) {
    if (operand.kind === "boolean") {
      if (operand.value !== neutral) {
        return operand
      }
    } else if (operand.kind === kind) {
      flat.push(...operand.operands)
    } else {
      flat.push(operand)
    }
  }
  if (flat.length === 0) {
    return neutral ? trueNode : falseNode
  }
  return flat.length === 1 ? flat[0]! : createNode({ kind, operands: flat })
}

/** Negates a predicate node, simplifying constants and double negation. */
export function negateNode(operand: ExpressionNode): ExpressionNode {
  if (operand.kind === "boolean") {
    return operand.value ? falseNode : trueNode
  }
  // NOT NOT x is x for NULL as well.
  if (operand.kind === "not") {
    return operand.operand
  }
  return createNode({ kind: "not", operand })
}
