import { describe, expect, it } from "bun:test"

import { toNode } from "../expression/expression"
import { and } from "../expression/predicates"
import { sql } from "../expression/sql"
import { from } from "../query/select"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { ExpressionNode, SelectNode } from "./nodes"
import { createList, createNode, createSelectNode } from "./nodes"
import { collectColumnKeys, mayAggregateSource } from "./references"
import {
  createDerivedSource,
  createExists,
  createInQuery,
  createLeftJoin,
  createOrder,
  createRef,
  createSubquery,
  createTextSubquery,
} from "./testing"

const form = defineTable("form", {
  id: t.integer,
  name: t.text,
  ownerId: t.integer,
  position: t.integer,
  rank: t.integer,
  status: t.text,
  group: t.integer,
  threshold: t.boolean,
})

it("collects the keys of the columns of a source at any depth of the queries nested in an expression, also of IN and of SQL text", () => {
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
          sql<boolean>`EXISTS ${createTextSubquery(
            createSelectNode(from(form).node.from, [
              { key: "status", expression: createRef(outer, "status"), type: t.text },
            ]),
          )}`,
        ),
      ),
    },
    groupBy: [createRef(outer, "group")],
    having: createRef(outer, "threshold"),
    orderBy: [createOrder(createRef(outer, "position"))],
  }
  const keys = new Set<string>()

  collectColumnKeys(toNode(createSubquery(nested, t.integer)), outer, keys)

  expect([...keys]).toEqual([
    "id",
    "ownerId",
    "name",
    "rank",
    "status",
    "group",
    "threshold",
    "position",
  ])
})

describe("mayAggregateSource", () => {
  const outer = from(form).node.from
  const inner = from(form).node.from
  const nest = (expression: ExpressionNode) =>
    toNode(
      createSubquery(
        createSelectNode(inner, [{ key: "value", expression, type: t.integer }]),
        t.integer,
      ),
    )

  it("detects a SQL fragment at any depth that refers to a column of a source outside the queries nested in it", () => {
    const createFragment = (...values: ExpressionNode[]) => createList("f(", values, ")")

    expect(mayAggregateSource(nest(createFragment(createRef(outer, "id"))), outer)).toBe(true)
    expect(mayAggregateSource(nest(nest(createFragment(createRef(outer, "id")))), outer)).toBe(true)
    expect(
      mayAggregateSource(
        nest(createFragment(createRef(outer, "id"), createRef(inner, "id"))),
        outer,
      ),
    ).toBe(true)
    expect(mayAggregateSource(nest(createFragment(createRef(inner, "id"))), outer)).toBe(false)
    expect(mayAggregateSource(nest(createFragment()), outer)).toBe(false)
    expect(mayAggregateSource(nest(createRef(outer, "id")), outer)).toBe(false)
  })

  it("finds the columns of a source in the arguments of an aggregate at any depth, also in the queries nested in them", () => {
    const createAggregate = (...args: ExpressionNode[]) =>
      createNode({ kind: "aggregate", name: "f", distinct: false, arguments: args, orderBy: [] })

    expect(mayAggregateSource(nest(createAggregate(createRef(outer, "id"))), outer)).toBe(true)
    expect(mayAggregateSource(nest(nest(createAggregate(createRef(outer, "id")))), outer)).toBe(
      true,
    )
    expect(
      mayAggregateSource(
        nest(createAggregate(createRef(outer, "id"), createRef(inner, "id"))),
        outer,
      ),
    ).toBe(true)
    expect(mayAggregateSource(nest(createAggregate(nest(createRef(outer, "id")))), outer)).toBe(
      true,
    )
    expect(mayAggregateSource(nest(createAggregate(createRef(inner, "id"))), outer)).toBe(false)
    expect(mayAggregateSource(nest(createAggregate(nest(createRef(inner, "id")))), outer)).toBe(
      false,
    )
  })

  it("does not count a query nested in a SQL fragment", () => {
    const fragment = createList("f(", [nest(createRef(outer, "id"))], ")")

    expect(mayAggregateSource(nest(fragment), outer)).toBe(false)
  })
})
