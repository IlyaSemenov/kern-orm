import { expect, it } from "bun:test"

import { createSelectNode } from "../../ast/nodes"
import { createDerivedSource, createRef } from "../../ast/testing"
import { from } from "../../query/select"
import { defineTable } from "../../table/table"
import * as t from "../../types"

import { CompileContext } from "./context"
import { declareSource, resolveSource } from "./scope"

const post = defineTable("post", {
  id: t.uuid,
})

it("resolves the sources of a scope and of the scopes outside it", () => {
  const context = new CompileContext(undefined)
  const outer = from(post).node.from
  const inner = from(post).node.from
  const scope = declareSource(context, declareSource(context, undefined, outer), inner)

  expect(resolveSource(scope, createRef(outer, "id")).alias).toBe("post")
  expect(resolveSource(scope, createRef(inner, "id")).alias).toBe("post_2")
})

it("resolves an occurrence of a table to a derived source that replaces it, named after the table", () => {
  const context = new CompileContext(undefined)
  const table = from(post).node.from
  const page = createDerivedSource(createSelectNode(table), { replaces: table })
  const scope = declareSource(context, undefined, page)

  expect(resolveSource(scope, createRef(table, "id"))).toBe(scope)
  expect(scope.alias).toBe("post")
  expect(() => declareSource(context, scope, table)).toThrow(
    'An occurrence of table "post" appears where it is already visible',
  )
})

it("rejects a derived source that replaces an occurrence of a table where the occurrence or another source that replaces it is visible", () => {
  const context = new CompileContext(undefined)
  const table = from(post).node.from
  const page = createDerivedSource(createSelectNode(table), { replaces: table })
  const otherPage = createDerivedSource(createSelectNode(table), { replaces: table })
  const error = "An occurrence of a subquery appears where it is already visible"

  expect(() => declareSource(context, declareSource(context, undefined, table), page)).toThrow(
    error,
  )
  expect(() => declareSource(context, declareSource(context, undefined, page), otherPage)).toThrow(
    error,
  )
})

it("rejects a source declared in another scope, although it has an alias", () => {
  const context = new CompileContext(undefined)
  const sibling = from(post).node.from
  declareSource(context, undefined, sibling)
  const scope = declareSource(context, undefined, from(post).node.from)

  expect(() => resolveSource(scope, createRef(sibling, "id"))).toThrow(
    'Column "id" of table "post" refers to a source that is not visible where it is used',
  )
})

it("rejects a source declared where it is already visible", () => {
  const context = new CompileContext(undefined)
  const source = from(post).node.from
  const scope = declareSource(context, undefined, source)

  expect(() => declareSource(context, scope, source)).toThrow(
    'An occurrence of table "post" appears where it is already visible',
  )
})
