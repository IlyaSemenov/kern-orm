import { describe, expect, it } from "bun:test"

import type { OrderNode, ProjectionNode } from "../ast/nodes"
import { toNode } from "../expression/expression"
import { sql } from "../expression/sql"
import { many } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { ColumnRefs } from "./column-refs"
import { noContext } from "./column-refs"
import type { NestedSelectionNode } from "./node"
import { addOrder, asc, desc, orderBy } from "./order"
import type { AnySelectQuery } from "./select"
import { from } from "./select"

const post = defineTable("post", {
  id: t.uuid,
  title: t.text,
  createdAt: t.timestamptz.columnName("created_at"),
})
const comment = defineTable("comment", {
  id: t.uuid,
  postId: t.uuid.columnName("post_id"),
})
const schema = defineSchema({ post, comment }).$relations({
  post: {
    comments: many(comment, { from: "id", to: "postId" }),
  },
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
      addOrder(posts.node, noContext, [
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

    expect(addOrder(node, noContext, ["id"])).toEqual([sortByColumn("title"), sortByColumn("id")])
    expect(node.orderBy).toEqual([sortByColumn("title")])
  })

  it("rejects an unknown column, an unknown direction, and other arguments", () => {
    expect(() => addOrder(posts.node, noContext, ["body"])).toThrow(
      'Unknown column "body" of table "post"',
    )
    expect(() => addOrder(posts.node, noContext, [{ toString: "asc" }])).toThrow(
      'Unknown column "toString" of table "post"',
    )
    expect(() => addOrder(posts.node, noContext, [{ id: "DESC" }])).toThrow(
      'Unknown sort direction "DESC"',
    )
    expect(() => addOrder(posts.node, noContext, [{ id: "toString" }])).toThrow(
      'Unknown sort direction "toString"',
    )
    expect(() => addOrder(posts.node, noContext, [{ id: undefined }])).toThrow(
      "Unknown sort direction undefined",
    )
    for (const arg of [1, null, ["id"]]) {
      expect(() => addOrder(posts.node, noContext, [arg])).toThrow(
        "orderBy takes column keys and objects of columns with directions, or a callback",
      )
    }
  })

  describe("callback", () => {
    it("sorts by an expression or an array of them, in ascending order or in their directions", () => {
      const upper = (columns: PostColumns) => sql`upper(${columns.title})`

      expect(addOrder(posts.node, noContext, [(columns: PostColumns) => columns.title])).toEqual([
        sortByColumn("title"),
      ])
      expect(
        addOrder(posts.node, noContext, [
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

    it("receives the relations of the table, and sorts by a query of one value in ascending order or in its direction", () => {
      expect(
        addOrder(schema.post.node, schema.post.context, [
          (columns: Record<"comments", AnySelectQuery>) => [
            columns.comments.count(),
            desc(columns.comments.exists()),
          ],
        ]),
      ).toMatchObject([
        {
          expression: { kind: "nestedQuery", query: { relation: { name: "comments" } } },
          direction: "asc",
        },
        {
          expression: { kind: "nestedQuery", query: { relation: { name: "comments" } } },
          direction: "desc",
        },
      ])
    })

    it("receives the expressions of the selected fields, sorting by their own nodes", () => {
      const query = posts.select("id").select(columns => ({
        upper: sql(t.text)`upper(${columns.title})`,
      }))
      const [id, upper] = query.node.projections as readonly ProjectionNode[]

      expect(
        addOrder(query.node, noContext, [
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
          addOrder(query.node, noContext, [(_columns: PostColumns, selected: never) => selected]),
        ).toEqual([{ expression: value!.expression, direction: "asc", nulls: undefined }])
      }
    })

    it("receives the expressions of the selected fields of an aggregate and of exists, and rejects reading a field of nested rows", () => {
      const query = posts.select(() => ({
        others: from(post).select("id"),
        otherCount: from(post).count(),
        hasOthers: from(post).exists(),
      }))
      const [, otherCount, hasOthers] = query.node.projections as readonly NestedSelectionNode[]

      expect(
        addOrder(query.node, noContext, [
          (_columns: PostColumns, selected: { otherCount: never; hasOthers: never }) => [
            desc(selected.otherCount),
            selected.hasOthers,
          ],
        ]),
      ).toEqual([
        {
          expression: {
            kind: "nestedQuery",
            query: otherCount!.query,
            db: undefined,
            field: otherCount,
          },
          direction: "desc",
          nulls: undefined,
        },
        {
          expression: {
            kind: "nestedQuery",
            query: hasOthers!.query,
            db: undefined,
            field: hasOthers,
          },
          direction: "asc",
          nulls: undefined,
        },
      ])
      expect(() =>
        addOrder(query.node, noContext, [
          (_columns: PostColumns, selected: { others: never }) => selected.others,
        ]),
      ).toThrow('Field "others" holds nested rows and cannot be sorted by')
    })

    it("rejects a result other than expressions, queries of one value, and sort keys", () => {
      expect(() => addOrder(posts.node, noContext, [() => "title"])).toThrow(
        "The callback of orderBy must return expressions, queries of one value, or sort keys of asc, desc, and orderBy",
      )
      expect(() => addOrder(posts.node, noContext, [() => [posts]])).toThrow(
        "An expression takes a query of one value",
      )
    })
  })
})

describe("asc, desc, and orderBy", () => {
  it("give an expression or a query of one value a direction", () => {
    const value = sql`${1}`
    const count = posts.count()

    expect(
      addOrder(posts.node, noContext, [
        () => [asc(value), desc(value), orderBy(value, "asc nulls last"), desc(count)],
      ]),
    ).toEqual([
      { expression: toNode(value), direction: "asc", nulls: undefined },
      { expression: toNode(value), direction: "desc", nulls: undefined },
      { expression: toNode(value), direction: "asc", nulls: "last" },
      {
        expression: { kind: "nestedQuery", query: count.node, db: undefined },
        direction: "desc",
        nulls: undefined,
      },
    ])
  })

  it("reject a value other than an expression and a query of one value, and an unknown direction", () => {
    expect(() => asc("title" as never)).toThrow(
      "A sort key must be an expression or a query of one value",
    )
    expect(() => desc(posts as never)).toThrow("An expression takes a query of one value")
    expect(() => orderBy(sql`1`, "descending" as never)).toThrow(
      'Unknown sort direction "descending"',
    )
  })
})
