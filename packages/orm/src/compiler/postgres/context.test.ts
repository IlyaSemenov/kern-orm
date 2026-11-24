import { expect, it } from "bun:test"

import type { CastNode } from "../../ast/nodes"
import { createNode } from "../../ast/nodes"
import * as t from "../../types"

import { CompileContext } from "./context"

it("numbers aliases of the same name apart from the names they could take", () => {
  const context = new CompileContext(undefined)

  expect([
    context.createAlias("post"),
    context.createAlias("post"),
    context.createAlias("post_2"),
    context.createAlias("post"),
  ]).toEqual(["post", "post_2", "post_2_2", "post_3"])
})

it("cuts aliases of names longer than 50 bytes", () => {
  const context = new CompileContext(undefined)
  const name = "a".repeat(63)

  expect([
    context.createAlias(name),
    context.createAlias(name),
    context.createAlias(`${name}1`),
  ]).toEqual(["a".repeat(50), `${"a".repeat(50)}_2`, `${"a".repeat(50)}_3`])
})

it("tells apart aliases of names that differ only by lone surrogates", () => {
  const context = new CompileContext(undefined)

  expect([context.createAlias("\ud800_outer"), context.createAlias("\ud801_inner")]).toEqual([
    "\ufffd_outer",
    "\ufffd_inner",
  ])
  expect([
    context.createAlias("\ud800".repeat(13)),
    context.createAlias("\ud801".repeat(13)),
  ]).toEqual(["\ufffd".repeat(12), `${"\ufffd".repeat(12)}_2`])
})

it("binds the parameter of a cast once, numbering it with the other parameters, and each call of bind apart", () => {
  const context = new CompileContext(undefined)
  const createCast = () =>
    createNode<CastNode>({
      kind: "cast",
      operand: createNode({ kind: "param", value: "UTC", type: t.text }),
      type: t.text,
    })
  const zone = createCast()

  expect([
    context.bindParam(zone, "UTC"),
    context.bind("x"),
    context.bindParam(zone, "UTC"),
    context.bindParam(createCast(), "UTC"),
    context.bind("x"),
  ]).toEqual(["$1", "$2", "$1", "$3", "$4"])
  expect(context.parameters).toEqual(["UTC", "x", "UTC", "x"])
})
