import { describe, expect, it } from "bun:test"

import { toNode } from "../expression/expression"
import { and } from "../expression/predicates"
import { sql } from "../expression/sql"
import { from } from "../query/select"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { ExpressionNode, SelectNode } from "./nodes"
import { createList, createNode, createSelectNode } from "./nodes"
import { aggregatesOuterSource, collectColumnKeys, mayAggregateSource } from "./references"
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
  category: t.integer,
})

it("collects the keys of the columns of a source at any depth of the queries nested in an expression, also of IN, of SQL text, and of the keys of DISTINCT ON", () => {
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
    distinctOn: [createRef(outer, "category")],
    groupBy: [createRef(outer, "group")],
    having: createRef(outer, "threshold"),
    orderBy: [createOrder(createRef(outer, "position"))],
  }
  const keys = new Set<string>()

  collectColumnKeys(toNode(createSubquery(nested, t.integer)), outer, keys)

  expect([...keys]).toEqual([
    "id",
    "ownerId",
    "category",
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

  const createFragment = (...values: ExpressionNode[]): ExpressionNode =>
    createList("f(", values, ")")
  const createAggregate = (...args: ExpressionNode[]): ExpressionNode =>
    createNode({
      kind: "aggregate",
      name: "f",
      distinct: false,
      arguments: args,
      orderBy: [],
      filter: undefined,
    })
  const createFilteredAggregate = (...values: ExpressionNode[]): ExpressionNode =>
    createNode({
      kind: "aggregate",
      name: "f",
      distinct: false,
      arguments: [],
      orderBy: [],
      filter: values.length === 0 ? undefined : createNode({ kind: "and", operands: values }),
    })

  it.each([
    ["a SQL fragment", createFragment],
    ["an aggregate", createAggregate],
    ["the filter of an aggregate", createFilteredAggregate],
  ] as const)(
    "finds the columns of a source in %s at any depth, also in the queries nested in it",
    (_kind, create) => {
      expect(mayAggregateSource(nest(create(createRef(outer, "id"))), outer)).toBe(true)
      expect(mayAggregateSource(nest(nest(create(createRef(outer, "id")))), outer)).toBe(true)
      expect(
        mayAggregateSource(nest(create(createRef(outer, "id"), createRef(inner, "id"))), outer),
      ).toBe(true)
      expect(mayAggregateSource(nest(create(nest(createRef(outer, "id")))), outer)).toBe(true)
      expect(mayAggregateSource(nest(create(createRef(inner, "id"))), outer)).toBe(false)
      expect(mayAggregateSource(nest(create(nest(createRef(inner, "id")))), outer)).toBe(false)
      expect(mayAggregateSource(nest(create()), outer)).toBe(false)
    },
  )

  it("does not count a column of a source outside an aggregate and a SQL fragment", () => {
    expect(mayAggregateSource(nest(createRef(outer, "id")), outer)).toBe(false)
  })
})

describe("aggregatesOuterSource", () => {
  const local = from(form).node.from
  const outer = from(form).node.from
  const inner = from(form).node.from
  const nest = (source: typeof inner, value: ExpressionNode) =>
    toNode(
      createSubquery(
        createSelectNode(source, [{ key: "value", expression: value, type: t.integer }]),
        t.integer,
      ),
    )

  it("distinguishes local, outer, constant, and mixed references", () => {
    expect(aggregatesOuterSource(createRef(local, "id"), local)).toBe(false)
    expect(aggregatesOuterSource(createRef(outer, "id"), local)).toBe(true)
    expect(aggregatesOuterSource(createList("1", [], ""), local)).toBe(false)
    expect(
      aggregatesOuterSource(
        createList("f(", [createRef(outer, "id"), createRef(local, "id")], ")"),
        local,
      ),
    ).toBe(false)
  })

  it("excludes bound columns but follows free references through subqueries", () => {
    expect(aggregatesOuterSource(nest(inner, createRef(inner, "id")), local)).toBe(false)
    expect(aggregatesOuterSource(nest(inner, createRef(outer, "id")), local)).toBe(true)
    expect(aggregatesOuterSource(nest(inner, createRef(local, "id")), local)).toBe(false)
    // Binding an occurrence in a sibling subquery must not hide a free reference to it.
    const siblings = createList(
      "f(",
      [nest(inner, createRef(inner, "id")), createRef(inner, "id")],
      ")",
    )
    expect(aggregatesOuterSource(siblings, local)).toBe(true)
  })

  it("excludes references bound by joins and replacing derived sources", () => {
    const derived = createDerivedSource(createSelectNode(inner))
    const query: SelectNode = {
      ...createSelectNode({ ...derived, replaces: inner }, [
        { key: "id", expression: createRef(inner, "id"), type: t.integer },
      ]),
      joins: [createLeftJoin(outer, createNode({ kind: "boolean", value: true }))],
      filters: { user: createRef(outer, "threshold") },
    }
    expect(aggregatesOuterSource(toNode(createSubquery(query, t.integer)), local)).toBe(false)
  })
})
