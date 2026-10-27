import { describe, expect, it } from "bun:test"

import type { OrderNode, ProjectionNode } from "../ast/nodes"
import { toNode } from "../expression/expression"
import { sql } from "../expression/sql"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { ColumnRefs } from "./column-refs"
import { addOrder, asc, desc, orderBy } from "./order"
import { from } from "./select"

const post = defineTable("post", {
  id: t.uuid,
  title: t.text,
  createdAt: t.timestamptz.columnName("created_at"),
})
const posts = from(post)
const source = posts.node.from

type PostColumns = ColumnRefs<typeof post>

/** Sort key node of the column `key` of `source`. */
function sortByColumn(
  key: string,
  direction: OrderNode["direction"] = "asc",
  nulls?: OrderNode["nulls"],
): OrderNode {
  return { expression: { kind: "column", source, key }, direction, nulls }
}

describe("addOrder", () => {
  it("sorts by column keys in ascending order and by objects of columns in their directions, in order", () => {
    expect(
      addOrder(posts.node, [
        "title",
        { createdAt: "desc nulls last", id: "asc nulls first" },
        { title: "desc" },
      ]),
    ).toEqual([
      sortByColumn("title"),
      sortByColumn("createdAt", "desc", "last"),
      sortByColumn("id", "asc", "first"),
      sortByColumn("title", "desc"),
    ])
  })

  it("adds the sort keys after the order of the query", () => {
    const node = posts.orderBy("title").node

    expect(addOrder(node, ["id"])).toEqual([sortByColumn("title"), sortByColumn("id")])
    expect(node.orderBy).toEqual([sortByColumn("title")])
  })

  it("rejects an unknown column, an unknown direction, and other arguments", () => {
    expect(() => addOrder(posts.node, ["body"])).toThrow('Unknown column "body" of table "post"')
    expect(() => addOrder(posts.node, [{ toString: "asc" }])).toThrow(
      'Unknown column "toString" of table "post"',
    )
    expect(() => addOrder(posts.node, [{ id: "DESC" }])).toThrow('Unknown sort direction "DESC"')
    expect(() => addOrder(posts.node, [{ id: "toString" }])).toThrow(
      'Unknown sort direction "toString"',
    )
    expect(() => addOrder(posts.node, [{ id: undefined }])).toThrow(
      "Unknown sort direction undefined",
    )
    for (const arg of [1, null, ["id"]]) {
      expect(() => addOrder(posts.node, [arg])).toThrow(
        "orderBy takes column keys and objects of columns with directions, or a callback",
      )
    }
  })

  describe("callback", () => {
    it("sorts by an expression or an array of them, in ascending order or in their directions", () => {
      const upper = (columns: PostColumns) => sql`upper(${columns.title})`

      expect(addOrder(posts.node, [(columns: PostColumns) => columns.title])).toEqual([
        sortByColumn("title"),
      ])
      expect(
        addOrder(posts.node, [
          (columns: PostColumns) => [
            desc(columns.createdAt),
            asc(columns.id),
            orderBy(upper(columns), "desc nulls first"),
          ],
        ]),
      ).toMatchObject([
        sortByColumn("createdAt", "desc"),
        sortByColumn("id"),
        {
          expression: { kind: "raw", fragments: ["upper(", ")"] },
          direction: "desc",
          nulls: "first",
        },
      ])
    })

    it("receives the expressions of the selected fields, sorting by their own nodes", () => {
      const query = posts.select("id").select(columns => ({
        upper: sql(t.text)`upper(${columns.title})`,
      }))
      const [id, upper] = query.node.projections as readonly ProjectionNode[]

      expect(
        addOrder(query.node, [
          (_columns: PostColumns, selected: { id: never; upper: never }) => [
            desc(selected.upper),
            selected.id,
          ],
        ]),
      ).toEqual([
        { expression: upper!.expression, direction: "desc", nulls: undefined },
        { expression: id!.expression, direction: "asc", nulls: undefined },
      ])
    })

    it("receives the expression of the value of a query made by get or pluck", () => {
      for (const query of [
        posts.pluck(columns => sql(t.text)`upper(${columns.title})`),
        posts.get("title"),
      ]) {
        const [value] = query.node.projections as readonly ProjectionNode[]

        expect(
          addOrder(query.node, [(_columns: PostColumns, selected: never) => selected]),
        ).toEqual([{ expression: value!.expression, direction: "asc", nulls: undefined }])
      }
    })

    it("rejects reading a field of nested rows", () => {
      const query = posts.select(() => ({
        others: from(post).select("id"),
      }))

      expect(() =>
        addOrder(query.node, [
          (_columns: PostColumns, selected: { others: never }) => selected.others,
        ]),
      ).toThrow('Field "others" holds nested rows and cannot be sorted by')
    })

    it("rejects a result other than expressions and sort keys", () => {
      const message =
        "The callback of orderBy must return expressions, or sort keys of asc, desc, and orderBy"

      expect(() => addOrder(posts.node, [() => "title"])).toThrow(message)
      expect(() => addOrder(posts.node, [() => [posts]])).toThrow(message)
    })
  })
})

describe("asc, desc, and orderBy", () => {
  it("give an expression a direction", () => {
    const value = sql`${1}`

    expect(
      addOrder(posts.node, [() => [asc(value), desc(value), orderBy(value, "asc nulls last")]]),
    ).toEqual([
      { expression: toNode(value), direction: "asc", nulls: undefined },
      { expression: toNode(value), direction: "desc", nulls: undefined },
      { expression: toNode(value), direction: "asc", nulls: "last" },
    ])
  })

  it("reject a value that is not an expression and an unknown direction", () => {
    expect(() => asc("title" as never)).toThrow("A sort key must be an expression")
    expect(() => orderBy(sql`1`, "descending" as never)).toThrow(
      'Unknown sort direction "descending"',
    )
  })
})
