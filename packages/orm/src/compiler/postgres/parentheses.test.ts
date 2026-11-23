import { expect, it } from "bun:test"

import type { ExpressionNode } from "../../ast/nodes"
import { createNode } from "../../ast/nodes"
import { createParameter, createRef } from "../../ast/testing"
import { defineTable } from "../../table/table"
import { integer } from "../../type/builtins/numeric"

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

it("puts the value of a read expression in parentheses unless it is a name, a parameter, a call, or a subquery", () => {
  const parameter = createParameter(1)
  const form = defineTable("form", {
    id: integer,
  })
  const column = createRef({ kind: "table", table: form }, "id")

  for (const node of [
    createBinary("+"),
    createNode({ kind: "cast", operand: parameter, type: integer }),
    createNode({ kind: "raw", fragments: ["now()"], values: [] }),
    createNode({ kind: "isNull", operand: parameter }),
  ] satisfies ExpressionNode[]) {
    expect(needsParentheses(node, "read")).toBe(true)
  }
  for (const node of [
    parameter,
    column,
    createNode({
      kind: "aggregate",
      name: "max",
      distinct: false,
      arguments: [column],
      orderBy: [],
      filter: undefined,
    }),
  ] satisfies ExpressionNode[]) {
    expect(needsParentheses(node, "read")).toBe(false)
  }
})

it("keeps a value read by a read expression as it is in an interpolation, and in parentheses elsewhere", () => {
  const read = createNode({ kind: "read", operand: createParameter(1), type: integer })

  expect(needsParentheses(read, "interpolation")).toBe(false)
  expect(needsParentheses(read, "value")).toBe(true)
})
