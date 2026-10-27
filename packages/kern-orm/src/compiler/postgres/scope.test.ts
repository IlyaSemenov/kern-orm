import { expect, it } from "bun:test"

import { ref } from "../../ast/testing"
import { from } from "../../query/select"
import { defineTable } from "../../table/table"
import * as t from "../../types"

import { CompileContext } from "./context"
import { declareSource, resolveAlias } from "./scope"

const post = defineTable("post", {
  id: t.uuid,
})

it("resolves the sources of a scope and of the scopes outside it", () => {
  const context = new CompileContext(undefined)
  const outer = from(post).node.from
  const inner = from(post).node.from
  const scope = declareSource(context, declareSource(context, undefined, outer), inner)

  expect(resolveAlias(scope, ref(outer, "id"))).toBe("post")
  expect(resolveAlias(scope, ref(inner, "id"))).toBe("post_2")
})

it("rejects a source declared in another scope, although it has an alias", () => {
  const context = new CompileContext(undefined)
  const sibling = from(post).node.from
  declareSource(context, undefined, sibling)
  const scope = declareSource(context, undefined, from(post).node.from)

  expect(() => resolveAlias(scope, ref(sibling, "id"))).toThrow(
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
