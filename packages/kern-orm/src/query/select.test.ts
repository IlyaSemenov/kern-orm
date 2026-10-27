import { describe, expect, it } from "bun:test"

import { compileSelect } from "../compiler/postgres/compile"
import { sql } from "../expression/sql"
import { lowerStatement } from "../lowering/lower"
import { defineTable } from "../table/table"
import * as t from "../types"

import { noContext } from "./column-refs"
import { desc } from "./order"
import type { AnySelectQuery } from "./select"
import { from, SelectQuery } from "./select"

const post = defineTable("post", {
  id: t.uuid,
  title: t.text,
  createdAt: t.timestamptz.columnName("created_at"),
})

/** Compiles `query` with the result plan, which `toSQL` leaves out. */
function compile(query: AnySelectQuery) {
  return compileSelect(lowerStatement(query.node))
}

/** Query of posts of one row without a limit, which no method builds yet, such as a future relation `one`. */
// oxlint-disable-next-line typescript/no-explicit-any -- a state that no method builds yet
function createUnlimited(rows: "one" | "optional"): SelectQuery<any> {
  return new SelectQuery(post, Object.freeze({ ...from(post).node, rows }), noContext)
}

it("compiles to SQL text and parameters, placing tables in the PostgreSQL schema of schemaName", () => {
  const query = from(post).where({ title: "First" }).select("id")

  expect(query.toSQL({ schemaName: "app" })).toEqual({
    text: 'SELECT "post"."id" AS "id" FROM "app"."post" AS "post" WHERE "post"."title" = $1',
    parameters: ["First"],
  })
})

it("leaves the query it derives from unchanged", () => {
  const base = from(post).select("id")
  base.select("title")
  base.clearSelect()
  base.get("title")
  base.pluck("title")
  base.take().optional()

  expect(compile(base)).toMatchObject({
    text: 'SELECT "post"."id" AS "id" FROM "post" AS "post"',
    rows: "many",
    value: false,
  })
  expect(compile(base).fields.map(field => field.key)).toEqual(["id"])
})

describe("select", () => {
  it("adds fields to the fields selected earlier, in the order of the calls", () => {
    const query = from(post)
      .select("id")
      .select(columns => ({
        heading: columns.title,
      }))
      .select("createdAt")

    expect(query.toSQL().text).toBe(
      'SELECT "post"."id" AS "id", "post"."title" AS "heading", "post"."created_at" AS "createdAt" FROM "post" AS "post"',
    )
  })

  it("compiles only the last expression and decoder selected under a key", () => {
    const base = from(post)
      .select(() => ({
        title: sql(t.integer)`${42}`,
      }))
      .select("id")
    const query = base
      .select(() => ({
        title: sql(t.text)`${"latest"}`,
      }))
      .select("id", "id")

    expect(compile(query)).toMatchObject({
      text: 'SELECT $1 AS "title", "post"."id" AS "id" FROM "post" AS "post"',
      parameters: ["latest"],
      fields: [
        { key: "title", type: t.text },
        { key: "id", type: t.uuid },
      ],
    })
    expect(compile(base)).toMatchObject({
      parameters: ["42"],
      fields: [
        { key: "title", type: t.integer },
        { key: "id", type: t.uuid },
      ],
    })
  })

  it("keeps filters on the columns under the keys of selected fields", () => {
    const query = from(post)
      .select(columns => ({
        id: columns.title,
        title: sql(t.integer)`1`,
      }))
      .where({ id: "id" })
      .where(columns => columns.title.eq("First"))

    expect(query.toSQL().text).toEndWith('WHERE "post"."id" = $1 AND "post"."title" = $2')
  })
})

describe("clearSelect", () => {
  it("clears the selected fields and keeps the other clauses", () => {
    const query = from(post)
      .select("id", "title")
      .where({ title: "First" })
      .take()
      .clearSelect()
      .select(columns => ({
        id: columns.title,
      }))

    expect(compile(query)).toMatchObject({
      text: 'SELECT "post"."title" AS "id" FROM "post" AS "post" WHERE "post"."title" = $1 LIMIT 1',
      rows: "one",
    })
  })
})

describe("take", () => {
  it("limits the query to one row and keeps its selection open", () => {
    const query = from(post).select("id").take().where({ title: "First" }).select("title")

    expect(compile(query)).toMatchObject({
      text: 'SELECT "post"."id" AS "id", "post"."title" AS "title" FROM "post" AS "post" WHERE "post"."title" = $1 LIMIT 1',
      rows: "one",
      value: false,
    })
  })

  it("limits a query with a limit or an offset to one row, keeping a limit of zero and the offset", () => {
    expect(from(post).select("id").limit(5).offset(10).take().toSQL()).toEqual({
      text: 'SELECT "post"."id" AS "id" FROM "post" AS "post" LIMIT 1 OFFSET $1',
      parameters: ["10"],
    })
    expect(from(post).select("id").limit(0).take().toSQL()).toEqual({
      text: 'SELECT "post"."id" AS "id" FROM "post" AS "post" LIMIT $1',
      parameters: ["0"],
    })
  })

  it("keeps a query of one row as it is, adding no limit", () => {
    for (const rows of ["one", "optional"] as const) {
      const query = createUnlimited(rows).select("id")

      expect(compile(query.take())).toEqual(compile(query))
      expect(compile(query)).toMatchObject({
        text: 'SELECT "post"."id" AS "id" FROM "post" AS "post"',
        rows,
      })
    }
  })
})

describe("get", () => {
  it("replaces the selected fields with a column or an expression and limits the query to one row", () => {
    const base = from(post).select("id", "createdAt")

    expect(compile(base.get("title"))).toMatchObject({
      text: 'SELECT "post"."title" AS "title" FROM "post" AS "post" LIMIT 1',
      fields: [{ key: "title", type: t.text }],
      rows: "one",
      value: true,
    })
    expect(
      compile(base.get("title").get(columns => sql(t.text)`upper(${columns.title})`)),
    ).toMatchObject({
      text: 'SELECT upper("post"."title") AS "value" FROM "post" AS "post" LIMIT 1',
      fields: [{ key: "value", type: t.text }],
      value: true,
    })
  })

  it("is pluck followed by take, keeping a query of one row as it is", () => {
    for (const query of [from(post), from(post).limit(0).offset(1), from(post).limit(2)]) {
      expect(compile(query.get("title"))).toEqual(compile(query.pluck("title").take()))
    }

    for (const rows of ["one", "optional"] as const) {
      const query = createUnlimited(rows).select("id")

      expect(compile(query.get("title"))).toEqual(compile(query.pluck("title")))
      expect(compile(query.get("title"))).toMatchObject({
        text: 'SELECT "post"."title" AS "title" FROM "post" AS "post"',
        rows,
        value: true,
      })
    }
  })

  it("makes a query of nullable reject without a row, keeping its limit", () => {
    expect(compile(from(post).take().nullable().get("title"))).toMatchObject({
      text: 'SELECT "post"."title" AS "title" FROM "post" AS "post" LIMIT 1',
      rows: "one",
      value: true,
    })
  })
})

describe("pluck", () => {
  it("replaces the selected fields with a column or an expression and keeps the rows mode", () => {
    const base = from(post).select("id", "createdAt")

    expect(compile(base.pluck("title"))).toMatchObject({
      text: 'SELECT "post"."title" AS "title" FROM "post" AS "post"',
      fields: [{ key: "title", type: t.text }],
      rows: "many",
      value: true,
    })
    expect(
      compile(base.take().pluck(columns => sql(t.text)`upper(${columns.title})`)),
    ).toMatchObject({
      text: 'SELECT upper("post"."title") AS "value" FROM "post" AS "post" LIMIT 1',
      fields: [{ key: "value", type: t.text }],
      rows: "one",
      value: true,
    })
  })

  it("makes a query of nullable reject without a row", () => {
    expect(compile(from(post).take().nullable().pluck("title"))).toMatchObject({
      text: 'SELECT "post"."title" AS "title" FROM "post" AS "post" LIMIT 1',
      rows: "one",
      value: true,
    })
  })

  it("rejects a change of the selection, as get does", () => {
    // Types reject these calls, which a query held as any query can still make.
    for (const query of [from(post).get("title"), from(post).pluck("title")] as AnySelectQuery[]) {
      expect(() => query.select("id")).toThrow(
        "select cannot be used after get or pluck; call one of them again to replace the value",
      )
      expect(() => query.clearSelect()).toThrow(
        "clearSelect cannot be used after get or pluck; call one of them again to replace the value",
      )
    }
  })
})

describe("orderBy", () => {
  it("sorts by columns and expressions, adding the sort keys of each call after the previous ones", () => {
    const query = from(post)
      .where({ title: "First" })
      .orderBy("title", { createdAt: "desc nulls last" })
      .orderBy(columns => [desc(sql`lower(${columns.title})`), columns.id])

    expect(query.toSQL()).toEqual({
      text: 'SELECT FROM "post" AS "post" WHERE "post"."title" = $1 ORDER BY "post"."title", "post"."created_at" DESC NULLS LAST, lower("post"."title") DESC, "post"."id"',
      parameters: ["First"],
    })
  })

  it("sorts an executed query by the positions of the selected columns and expressions", () => {
    const query = from(post)
      .select("id")
      .select(columns => ({
        rank: sql(t.integer)`length(${columns.title}) + ${1}`,
      }))
      .orderBy((columns, selected) => [desc(selected.rank), columns.title, columns.id])

    expect(query.toSQL()).toEqual({
      text: 'SELECT "post"."id" AS "id", length("post"."title") + $1 AS "rank" FROM "post" AS "post" ORDER BY 2 DESC, "post"."title", 1',
      parameters: ["1"],
    })
  })

  it("sorts a query of values by the position of its value", () => {
    const query = from(post)
      .pluck(columns => sql(t.integer)`length(${columns.title})`)
      .orderBy((_columns, value) => desc(value))

    expect(query.toSQL().text).toBe(
      'SELECT length("post"."title") AS "value" FROM "post" AS "post" ORDER BY 1 DESC',
    )
  })

  it("keeps the expression of a selected field that a later selection replaces", () => {
    const query = from(post)
      .select(columns => ({
        rank: sql(t.integer)`length(${columns.title})`,
      }))
      .orderBy((_columns, selected) => selected.rank)
      .clearSelect()
      .select("id")

    expect(query.toSQL().text).toBe(
      'SELECT "post"."id" AS "id" FROM "post" AS "post" ORDER BY length("post"."title")',
    )
  })

  it("sorts a query of one row as it sorts the rows before take", () => {
    const query = from(post).select("id")

    expect(compile(query.take().orderBy("title"))).toEqual(compile(query.orderBy("title").take()))
  })
})

describe("limit and offset", () => {
  it("limit and skip the rows of a query of many rows, replacing earlier calls", () => {
    const query = from(post).select("id").limit(10).offset(20).limit(5).offset(0)

    expect(query.toSQL()).toEqual({
      text: 'SELECT "post"."id" AS "id" FROM "post" AS "post" LIMIT $1 OFFSET $2',
      parameters: ["5", "0"],
    })
  })

  it("reject a query of one row", () => {
    // Types reject these calls, which a query held as any query can still make.
    const query: AnySelectQuery = from(post).take()

    expect(() => query.limit(1)).toThrow(
      "limit applies only to a query of many rows; call it before take or get",
    )
    expect(() => query.offset(1)).toThrow(
      "offset applies only to a query of many rows; call it before take or get",
    )
  })

  it("reject a number of rows that is not a non-negative integer", () => {
    for (const count of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => from(post).limit(count)).toThrow(
        `limit takes a non-negative integer, not ${count}`,
      )
      expect(() => from(post).offset(count)).toThrow(
        `offset takes a non-negative integer, not ${count}`,
      )
    }
  })
})

describe("optional", () => {
  it("applies to a query of one row whatever changes it before or after", () => {
    const before = from(post).take().optional().get("title").where({ title: "First" })
    const after = from(post).take().get("title").where({ title: "First" }).optional()

    expect(compile(before)).toEqual(compile(after))
    expect(compile(after)).toMatchObject({ rows: "optional", value: true })
  })

  it("rejects a query of many rows", () => {
    const query: AnySelectQuery = from(post)

    expect(() => query.optional()).toThrow(
      "optional applies only to a query of one row, such as one made by take",
    )
  })
})

describe("nullable", () => {
  it("makes a query of one record resolve to null without a row", () => {
    expect(compile(from(post).select("id").take().nullable())).toMatchObject({
      text: 'SELECT "post"."id" AS "id" FROM "post" AS "post" LIMIT 1',
      rows: "nullable",
      value: false,
    })
    expect(compile(from(post).take().optional().nullable())).toMatchObject({ rows: "nullable" })
  })

  it("rejects a query of many rows and a query of values", () => {
    // Types reject these calls, which a query held as any query can still make.
    const query: AnySelectQuery = from(post)

    expect(() => query.nullable()).toThrow(
      "nullable applies only to a query of one row, such as one made by take",
    )
    expect(() => (query.get("title") as AnySelectQuery).nullable()).toThrow(
      "nullable applies only to a query of records; use optional after get or pluck",
    )
  })
})

describe("required", () => {
  it("makes a query of one row reject without a row", () => {
    const queries: AnySelectQuery[] = [from(post).take().optional(), from(post).take().nullable()]
    for (const query of queries) {
      expect(compile(query.required())).toEqual(compile(from(post).take()))
    }
  })

  it("rejects a query of many rows", () => {
    const query: AnySelectQuery = from(post)

    expect(() => query.required()).toThrow(
      "required applies only to a query of one row, such as one made by take",
    )
  })
})

describe("use", () => {
  it("returns the query that the callback derives from the query", () => {
    const query = from(post)
      .select("id")
      .use(posts => posts.where({ title: "First" }).take())

    expect(compile(query)).toMatchObject({
      text: 'SELECT "post"."id" AS "id" FROM "post" AS "post" WHERE "post"."title" = $1 LIMIT 1',
      rows: "one",
    })
  })

  it("passes further arguments to the callback", () => {
    const query = from(post).use((posts, title: string) => posts.where({ title }), "First")

    expect(query.toSQL().parameters).toEqual(["First"])
  })

  it("selects a column after a branch that may have selected it", () => {
    for (const withTitle of [false, true]) {
      const query = from(post)
        .select("id")
        .use(posts => (withTitle ? posts.select("title") : posts))
        .select("title")

      expect(query.toSQL().text).toBe(
        'SELECT "post"."id" AS "id", "post"."title" AS "title" FROM "post" AS "post"',
      )
    }
  })

  it("rejects a result that does not derive from the query", () => {
    const query: AnySelectQuery = from(post)
    const message = "The callback of use must return the query it receives or one derived from it"

    expect(() => query.use(() => from(post))).toThrow(message)
    // @ts-expect-error The callback returns a query, not a Promise.
    expect(() => query.use(() => Promise.resolve(query))).toThrow(message)
  })
})
