import { expect, it } from "bun:test"

import type { ExpressionNode } from "../../ast/nodes"
import { createNode } from "../../ast/nodes"
import { createParameter } from "../../ast/testing"

import { getBinaryPositions, needsParentheses } from "./parentheses"

function createBinary(operator: string): ExpressionNode {
  return createNode({
    kind: "binary",
    operator,
    left: createParameter(1),
    right: createParameter(2),
  })
}

// Operators from the tightest to the loosest precedence of PostgreSQL, one of each.
const operatorsByPrecedence = ["^", "*", "+", "||"]

it("puts an operand of a looser operator in parentheses on either side", () => {
  for (const [index, parent] of operatorsByPrecedence.entries()) {
    const positions = getBinaryPositions(parent)
    for (const child of operatorsByPrecedence.slice(index + 1)) {
      expect(needsParentheses(createBinary(child), positions.left)).toBe(true)
      expect(needsParentheses(createBinary(child), positions.right)).toBe(true)
    }
  }
})

it("puts an operand of a tighter operator in no parentheses on either side", () => {
  for (const [index, parent] of operatorsByPrecedence.entries()) {
    const positions = getBinaryPositions(parent)
    for (const child of operatorsByPrecedence.slice(0, index)) {
      expect(needsParentheses(createBinary(child), positions.left)).toBe(false)
      expect(needsParentheses(createBinary(child), positions.right)).toBe(false)
    }
  }
})

it.each(["^", "*", "/", "%", "+", "-", "||", "->"])(
  "groups operators of the precedence of %s from the left",
  operator => {
    const positions = getBinaryPositions(operator)

    expect(needsParentheses(createBinary(operator), positions.left)).toBe(false)
    expect(needsParentheses(createBinary(operator), positions.right)).toBe(true)
  },
)

it("puts a binary operator in parentheses in a cast and in an interpolation, but not in a comparison", () => {
  for (const operator of operatorsByPrecedence) {
    expect(needsParentheses(createBinary(operator), "value")).toBe(false)
    expect(needsParentheses(createBinary(operator), "cast")).toBe(true)
    expect(needsParentheses(createBinary(operator), "interpolation")).toBe(true)
  }
})
