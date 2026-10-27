import { describe, expect, it } from "bun:test"

import type { SelectNode } from "../ast/nodes"
import { createOrder, createParameter, createRef } from "../ast/testing"
import { compileStatement } from "../compiler/postgres/compile"
import { toNode } from "../expression/expression"
import { sql } from "../expression/sql"
import { createColumnRefs } from "../query/column-refs"
import { from } from "../query/select"
import { defineTable } from "../table/table"
import * as t from "../types"

import { deriveOrderedSource } from "./order"
import { lower } from "./testing"

const field = defineTable("form_field", {
  id: t.integer,
  label: t.text.nullable(),
  position: t.integer,
})

describe("deriveOrderedSource", () => {
  const allFields = from(field)
  const position = createRef(allFields.node.from, "position")

  /** Query `node` with `changes`, such as an order or a limit. */
  function change(node: SelectNode, changes: Partial<SelectNode>): SelectNode {
    return { ...node, ...changes }
  }

  it("sorts the rows of a page by the positions of sort keys added to the source, and the aggregate by the sort keys", () => {
    const labels = change(lower(allFields.select("label")), {
      orderBy: [createOrder(position, "desc", "last")],
      limit: createParameter(2),
    })
    const { source, order } = deriveOrderedSource(labels, true)

    expect(compileStatement(source.query).text).toBe(
      'SELECT "form_field"."label" AS "label", "form_field"."position" AS "$order1" FROM "form_field" AS "form_field" ORDER BY 2 DESC NULLS LAST LIMIT $1',
    )
    expect(order).toEqual([createOrder(createRef(source, "$order1"), "desc", "last")])
  })

  it("sorts only the aggregate without a limit or an offset", () => {
    const labels = change(lower(allFields.select("label")), { orderBy: [createOrder(position)] })
    const { source, order } = deriveOrderedSource(labels, true)

    expect(compileStatement(source.query).text).toBe(
      'SELECT "form_field"."label" AS "label", "form_field"."position" AS "$order1" FROM "form_field" AS "form_field"',
    )
    expect(order).toEqual([createOrder(createRef(source, "$order1"))])
  })

  it("sorts only the rows of a page for an aggregate that does not take them in order", () => {
    const labels = change(lower(allFields.select("label")), {
      orderBy: [createOrder(position)],
      offset: createParameter(2),
    })
    const { source, order } = deriveOrderedSource(labels, false)

    expect(compileStatement(source.query).text).toBe(
      'SELECT "form_field"."label" AS "label", "form_field"."position" AS "$order1" FROM "form_field" AS "form_field" ORDER BY 2 OFFSET $1',
    )
    expect(order).toEqual([])
  })

  it("reuses a selected column as a sort key", () => {
    const labels = change(lower(allFields.select("label", "position")), {
      orderBy: [createOrder(position, "desc")],
    })
    const { source, order } = deriveOrderedSource(labels, true)

    expect(source.query.projections.map(projection => projection.key)).toEqual([
      "label",
      "position",
    ])
    expect(order).toEqual([createOrder(createRef(source, "position"), "desc")])
  })

  it("gives a sort key a key that no selected field has", () => {
    const labels = change(
      lower(
        allFields.select(columns => ({
          $order1: columns.label,
          $order1_2: columns.position,
        })),
      ),
      { orderBy: [createOrder(createRef(allFields.node.from, "id"))] },
    )
    const { source, order } = deriveOrderedSource(labels, true)

    expect(source.query.projections.map(projection => projection.key)).toEqual([
      "$order1",
      "$order1_2",
      "$order1_3",
    ])
    expect(order).toEqual([createOrder(createRef(source, "$order1_3"))])
  })

  it("reuses a selected sort expression other than a column only as the same node", () => {
    const columns = createColumnRefs<typeof field>(allFields.node.from)
    const lowerLabel = sql(t.text)`lower(${columns.label})`
    const lowered = lower(
      allFields.select(() => ({
        lower: lowerLabel,
      })),
    )
    const equal = deriveOrderedSource(
      change(lowered, { orderBy: [createOrder(toNode(sql`lower(${columns.label})`), "desc")] }),
      true,
    )
    const same = deriveOrderedSource(
      change(lowered, { orderBy: [createOrder(toNode(lowerLabel), "desc")] }),
      true,
    )

    expect(equal.source.query.projections.map(projection => projection.key)).toEqual([
      "lower",
      "$order1",
    ])
    expect(same.source.query.projections.map(projection => projection.key)).toEqual(["lower"])
    expect(same.order).toEqual([createOrder(createRef(same.source, "lower"), "desc")])
  })
})
