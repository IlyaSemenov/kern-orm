import { expect, it } from "bun:test"

import { toNode } from "../expression/expression"
import { and } from "../expression/predicates"
import { from } from "../query/select"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { ExpressionNode, SelectNode } from "./nodes"
import { createList, createNode, createSelectNode } from "./nodes"
import { collectColumnKeys, holdsFragmentOfSource } from "./references"
import {
  createDerivedSource,
  createExists,
  createInQuery,
  createLeftJoin,
  createOrder,
  createRef,
  createSubquery,
} from "./testing"

const form = defineTable("form", {
  id: t.integer,
  name: t.text,
  ownerId: t.integer,
  position: t.integer,
  rank: t.integer,
})

it("collects the keys of the columns of a source at any depth of the queries nested in an expression, also of IN", () => {
  const outer = from(form).node.from
  const inner = from(form).node.from
  const joined = from(form).node.from
  const derived = createDerivedSource(
    createSelectNode(inner, [{ key: "id", expression: createRef(outer, "id"), type: t.integer }]),
  )
  const nested: SelectNode = {
    ...createSelectNode(derived),
    joins: [
      createLeftJoin(
        joined,
        createNode({
          kind: "comparison",
          operator: "=",
          left: createRef(joined, "id"),
          right: createRef(outer, "ownerId"),
        }),
      ),
    ],
    filters: {
      user: toNode(
        and(
          createExists(
            createSelectNode(inner, [
              { key: "name", expression: createRef(outer, "name"), type: t.text },
            ]),
          ),
          createInQuery(
            createRef(inner, "id"),
            createSelectNode(from(form).node.from, [
              { key: "rank", expression: createRef(outer, "rank"), type: t.integer },
            ]),
          ),
        ),
      ),
    },
    orderBy: [createOrder(createRef(outer, "position"))],
  }
  const keys = new Set<string>()

  collectColumnKeys(toNode(createSubquery(nested, t.integer)), outer, keys)

  expect([...keys]).toEqual(["id", "ownerId", "name", "rank", "position"])
})

it("detects a SQL fragment at any depth that refers to a column of a source outside the queries nested in it", () => {
  const outer = from(form).node.from
  const inner = from(form).node.from
  const nest = (expression: ExpressionNode) =>
    toNode(
      createSubquery(
        createSelectNode(inner, [{ key: "value", expression, type: t.integer }]),
        t.integer,
      ),
    )
  const createFragment = (...values: ExpressionNode[]) => createList("f(", values, ")")

  expect(holdsFragmentOfSource(nest(createFragment(createRef(outer, "id"))), outer)).toBe(true)
  expect(holdsFragmentOfSource(nest(nest(createFragment(createRef(outer, "id")))), outer)).toBe(
    true,
  )
  expect(
    holdsFragmentOfSource(
      nest(createFragment(createRef(outer, "id"), createRef(inner, "id"))),
      outer,
    ),
  ).toBe(true)
  expect(holdsFragmentOfSource(nest(createFragment(createRef(inner, "id"))), outer)).toBe(false)
  expect(holdsFragmentOfSource(nest(createFragment()), outer)).toBe(false)
  expect(holdsFragmentOfSource(nest(createRef(outer, "id")), outer)).toBe(false)
})
