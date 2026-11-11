import { describe, expect, it } from "bun:test"

import { compileStatement } from "../compiler/postgres/compile"
import { sql } from "../expression/sql"
import { lowerStatement } from "../lowering/lower"
import { defineTable } from "../table/table"
import * as t from "../types"

import { countType } from "./aggregate"
import { literal } from "./literal"
import { desc } from "./order"
import type { AnySelectQuery } from "./select"
import { from } from "./select"

const post = defineTable("post", {
  id: t.uuid.primaryKey(),
  title: t.text,
  createdAt: t.timestamptz.columnName("created_at"),
})

/** Compiles `query` with the result plan, which `toSQL` leaves out. */
function compile(query: AnySelectQuery) {
  return compileStatement(lowerStatement(query.node))
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
    const query = from(post).find("post-id").select("id")

    expect(compile(query.take())).toEqual(compile(query))
    expect(compile(query.optional().take())).toEqual(compile(query.optional()))
    expect(compile(query)).toMatchObject({
      text: 'SELECT "post"."id" AS "id" FROM "post" AS "post" WHERE "post"."id" = $1',
      rows: "one",
    })
  })
})

describe("find and findBy", () => {
  const membership = defineTable(
    "membership",
    {
      userId: t.uuid,
      groupId: t.uuid.columnName("group_id"),
      code: t.text.unique(),
      role: t.text,
    },
    { primaryKey: ["userId", "groupId"] },
  )

  it("filter by the values of a key and return one row without a limit", () => {
    const query = from(membership).select("role")

    expect(compile(query.find("user-id", "group-id"))).toMatchObject({
      text: 'SELECT "membership"."role" AS "role" FROM "membership" AS "membership" WHERE "membership"."userId" = $1 AND "membership"."group_id" = $2',
      parameters: ["user-id", "group-id"],
      rows: "one",
    })
    expect(compile(query.findBy({ groupId: "group-id", userId: "user-id" }))).toMatchObject({
      text: 'SELECT "membership"."role" AS "role" FROM "membership" AS "membership" WHERE "membership"."group_id" = $1 AND "membership"."userId" = $2',
      rows: "one",
    })
    expect(compile(query.findBy({ code: "code" }))).toMatchObject({
      text: 'SELECT "membership"."role" AS "role" FROM "membership" AS "membership" WHERE "membership"."code" = $1',
      rows: "one",
    })
  })

  it("keep a limit and an offset, which choose among the rows of the key", () => {
    const query = from(membership).select("role")

    expect(compile(query.limit(0).find("user-id", "group-id")).text).toEndWith("LIMIT $3")
    expect(compile(query.offset(1).findBy({ code: "code" })).text).toEndWith("OFFSET $2")
  })

  it("take an expression, such as a column of the row of a parent query", () => {
    const group = defineTable("group", {
      id: t.uuid.primaryKey(),
      name: t.text,
    })
    const query = from(membership).select(columns => ({
      group: from(group).find(columns.groupId).select("name"),
    }))

    expect(query.toSQL().text).toContain(
      'FROM "group" AS "group" WHERE "group"."id" = "membership"."group_id")',
    )
  })

  it("keep the rows mode and the value of a query of one row", () => {
    const query = from(membership).take().optional().pluck("role")

    expect(compile(query.find("user-id", "group-id"))).toEqual(
      compile(query.where({ userId: "user-id", groupId: "group-id" })),
    )
    expect(compile(query.findBy({ code: "code" }))).toMatchObject({
      rows: "optional",
      value: true,
    })
  })

  it("reject what types reject", () => {
    // Types reject these calls, which a query held as any query can still make.
    const query: AnySelectQuery = from(membership)

    expect(() => query.find("user-id")).toThrow(
      'find takes one value for each column of the primary key of table "membership", "userId", "groupId", not 1',
    )
    expect(() => query.findBy({ userId: "user-id", code: "code" })).toThrow(
      'findBy takes the columns of one key of table "membership", primary or unique, not columns "userId", "code"',
    )
  })
})

describe("queries of a singleton table", () => {
  const license = defineTable(
    "license",
    {
      id: t.uuid.primaryKey(),
      token: t.text,
    },
    { singleton: true },
  )

  it("start as a query of its one row without a limit, which resolves to undefined without it", () => {
    expect(compile(from(license))).toMatchObject({
      text: 'SELECT FROM "license" AS "license"',
      rows: "optional",
      value: false,
    })
    expect(compile(from(license).get("token"))).toMatchObject({
      text: 'SELECT "license"."token" AS "token" FROM "license" AS "license"',
      rows: "optional",
      value: true,
    })
    expect(compile(from(license).take())).toEqual(compile(from(license)))
  })

  it("take the methods of a query of one row, such as required, nullable, find, count, and exists", () => {
    expect(compile(from(license).required()).rows).toBe("one")
    expect(compile(from(license).nullable()).rows).toBe("nullable")
    expect(compile(from(license).find("license-id"))).toMatchObject({
      text: 'SELECT FROM "license" AS "license" WHERE "license"."id" = $1',
      rows: "optional",
    })
    expect(compile(from(license).count())).toMatchObject({
      text: 'SELECT count(*) AS "count" FROM "license" AS "license"',
      rows: "one",
    })
    expect(compile(from(license).exists()).text).toBe(
      'SELECT EXISTS (SELECT FROM "license" AS "license") AS "exists"',
    )
  })

  it("reject the methods of a query of many rows", () => {
    // Types reject these calls, which a query held as any query can still make.
    const query: AnySelectQuery = from(license)

    expect(() => query.all()).toThrow("all applies only to a query of many rows")
    expect(() => query.limit(1)).toThrow("limit applies only to a query of many rows")
    expect(() => query.offset(1)).toThrow(/^offset applies only to a query of many rows$/)
    expect(() => query.distinct()).toThrow("distinct applies only to a query of many rows")
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

    const query = from(post).find("post-id").select("id")

    expect(compile(query.get("title"))).toEqual(compile(query.pluck("title")))
    expect(compile(query.optional().get("title"))).toEqual(compile(query.optional().pluck("title")))
    expect(compile(query.get("title"))).toMatchObject({
      text: 'SELECT "post"."title" AS "title" FROM "post" AS "post" WHERE "post"."id" = $1',
      rows: "one",
      value: true,
    })
  })

  it("makes a nullable query optional, keeping its limit", () => {
    expect(compile(from(post).take().nullable().get("title"))).toMatchObject({
      text: 'SELECT "post"."title" AS "title" FROM "post" AS "post" LIMIT 1',
      rows: "optional",
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

  it("makes a nullable query optional", () => {
    expect(compile(from(post).take().nullable().pluck("title"))).toMatchObject({
      text: 'SELECT "post"."title" AS "title" FROM "post" AS "post" LIMIT 1',
      rows: "optional",
      value: true,
    })
  })

  it("rejects a change of the selection, as get does", () => {
    // Types reject these calls, which a query held as any query can still make.
    for (const query of [from(post).get("title"), from(post).pluck("title")] as AnySelectQuery[]) {
      expect(() => query.select("id")).toThrow(
        "select cannot be used after get or pluck; call get or pluck to replace the value",
      )
      expect(() => query.clearSelect()).toThrow(
        "clearSelect cannot be used after get or pluck; call get or pluck to replace the value",
      )
    }
  })
})

describe("count", () => {
  it("replaces the selected fields with the number of rows, keeping the filters and ignoring the order", () => {
    const query = from(post).where({ title: "First" }).select("id").orderBy("title").count()

    expect(compile(query)).toMatchObject({
      text: 'SELECT count(*) AS "count" FROM "post" AS "post" WHERE "post"."title" = $1',
      parameters: ["First"],
      fields: [{ key: "count", type: countType }],
      rows: "one",
      value: true,
    })
  })

  it("counts the rows of a page through a derived source", () => {
    expect(from(post).orderBy("title").limit(20).offset(40).count().toSQL()).toEqual({
      text: 'SELECT count(*) AS "count" FROM (SELECT FROM "post" AS "post" LIMIT $1 OFFSET $2) AS "subquery"',
      parameters: ["20", "40"],
    })
    expect(from(post).where({ title: "First" }).take().count().toSQL()).toEqual({
      text: 'SELECT count(*) AS "count" FROM (SELECT FROM "post" AS "post" WHERE "post"."title" = $1 LIMIT 1) AS "subquery"',
      parameters: ["First"],
    })
  })

  it("applies to a query of any rows and value", () => {
    const found = from(post).find("post-id")
    const expected = compile(from(post).where({ id: "post-id" }).count())

    expect(compile(from(post).pluck("title").count())).toEqual(compile(from(post).count()))
    expect(compile(found.optional().count())).toEqual(expected)
    expect(compile(found.get("title").count())).toEqual(expected)
  })

  it("counts the rows that a later filter chooses, ignoring a later order", () => {
    expect(compile(from(post).count().where({ title: "First" }).orderBy("title"))).toEqual(
      compile(from(post).where({ title: "First" }).count()),
    )
  })

  it("rejects a change of the selection or the value, another aggregate, and nullable, also after the methods that keep its value", () => {
    // Types reject these calls, which a query held as any query can still make.
    for (const query of [
      from(post).count(),
      from(post).count().where({ title: "First" }).coalesce(0),
    ] as AnySelectQuery[]) {
      for (const [method, call] of [
        ["select", () => query.select("id")],
        ["clearSelect", () => query.clearSelect()],
        ["get", () => query.get("title")],
        ["pluck", () => query.pluck("title")],
        ["count", () => query.count()],
        ["count", () => query.count("title")],
        ["max", () => query.max("title")],
        ["stringAgg", () => query.stringAgg("title", ", ")],
        ["exists", () => query.exists()],
      ] as const) {
        expect(call).toThrow(`${method} cannot be used after an aggregate`)
      }
      expect(() => query.nullable()).toThrow(
        "nullable applies only to a query of records; use optional after get, pluck, or an aggregate",
      )
    }
  })
})

describe("aggregates", () => {
  const visit = defineTable("visit", {
    page: t.text,
    seconds: t.integer,
    bounced: t.boolean,
  })

  it("replace the selected fields with the aggregate of a column or an expression, keeping the filters and ignoring the order", () => {
    const query = from(visit).where({ page: "/" }).select("page").orderBy("page").max("seconds")

    expect(compile(query)).toMatchObject({
      text: 'SELECT max("visit"."seconds") AS "max" FROM "visit" AS "visit" WHERE "visit"."page" = $1',
      parameters: ["/"],
      fields: [{ key: "max", type: t.integer }],
      rows: "one",
      value: true,
    })
  })

  it("call the aggregate function of each method", () => {
    for (const [query, call] of [
      [from(visit).count("page"), 'count("visit"."page") AS "count"'],
      [from(visit).countDistinct("page"), 'count(DISTINCT "visit"."page") AS "countDistinct"'],
      [from(visit).min("seconds"), 'min("visit"."seconds") AS "min"'],
      [from(visit).sum("seconds"), 'sum("visit"."seconds") AS "sum"'],
      [
        from(visit).max(columns => sql(t.integer)`${columns.seconds} * 2`),
        'max("visit"."seconds" * 2) AS "max"',
      ],
      [from(visit).avg("seconds"), 'avg("visit"."seconds") AS "avg"'],
      [from(visit).every("bounced"), 'bool_and("visit"."bounced") AS "every"'],
      [from(visit).some("bounced"), 'bool_or("visit"."bounced") AS "some"'],
    ] as const) {
      expect(query.toSQL().text).toBe(`SELECT ${call} FROM "visit" AS "visit"`)
    }
  })

  it("join the values of stringAgg with the delimiter in the order of the query, also of a later orderBy", () => {
    const expected = {
      text: 'SELECT string_agg("visit"."page", $1 ORDER BY "visit"."seconds" DESC) AS "stringAgg" FROM "visit" AS "visit"',
      parameters: [", "],
    }

    expect(from(visit).orderBy({ seconds: "desc" }).stringAgg("page", ", ").toSQL()).toEqual(
      expected,
    )
    expect(from(visit).stringAgg("page", ", ").orderBy({ seconds: "desc" }).toSQL()).toEqual(
      expected,
    )
  })

  it("aggregate the rows of a page, chosen in the order of the query, through a derived source", () => {
    expect(from(visit).orderBy({ seconds: "desc" }).limit(10).sum("seconds").toSQL()).toEqual({
      text: 'SELECT sum("subquery"."value") AS "sum" FROM (SELECT "visit"."seconds" AS "value" FROM "visit" AS "visit" ORDER BY 1 DESC LIMIT $1) AS "subquery"',
      parameters: ["10"],
    })
    expect(from(visit).orderBy("seconds").offset(5).stringAgg("page", ", ").toSQL()).toEqual({
      text: 'SELECT string_agg("subquery"."value", $1 ORDER BY "subquery"."$order1") AS "stringAgg" FROM (SELECT "visit"."page" AS "value", "visit"."seconds" AS "$order1" FROM "visit" AS "visit" ORDER BY 2 OFFSET $2) AS "subquery"',
      parameters: [", ", "5"],
    })
  })

  it("aggregate an argument that refers only to an enclosing query through a derived source", () => {
    const query = from(post).select(columns => ({
      titleLengths: from(visit)
        .where(visitColumns => visitColumns.page.eq(columns.title))
        .sum(() => sql(t.integer)`length(${columns.title})`),
    }))

    expect(query.toSQL().text).toBe(
      'SELECT (SELECT sum("subquery"."value") AS "sum" FROM (SELECT length("post"."title") AS "value" FROM "visit" AS "visit" WHERE "visit"."page" = "post"."title") AS "subquery") AS "titleLengths" FROM "post" AS "post"',
    )
  })

  it("reject an expression without a type, as get does", () => {
    expect(() => from(visit).max(() => sql<number>`1` as never)).toThrow(
      "The expression of max has no type to decode its values; build a sql fragment with a type, such as sql(t.integer)",
    )
  })
})

describe("exists", () => {
  it("replaces the selected fields with whether the query has a row, keeping the filters, the limit, and the offset and ignoring the order", () => {
    const query = from(post)
      .where({ title: "First" })
      .select("id")
      .orderBy("title")
      .limit(5)
      .offset(10)
      .exists()

    expect(compile(query)).toMatchObject({
      text: 'SELECT EXISTS (SELECT FROM "post" AS "post" WHERE "post"."title" = $1 LIMIT $2 OFFSET $3) AS "exists"',
      parameters: ["First", "5", "10"],
      fields: [{ key: "exists", type: t.boolean }],
      rows: "one",
      value: true,
    })
  })

  it("applies to a query of any rows and value", () => {
    const found = from(post).find("post-id")

    expect(compile(from(post).pluck("title").exists())).toEqual(compile(from(post).exists()))
    expect(compile(found.get("title").optional().exists())).toEqual(
      compile(from(post).where({ id: "post-id" }).exists()),
    )
    expect(from(post).take().exists().toSQL().text).toBe(
      'SELECT EXISTS (SELECT FROM "post" AS "post" LIMIT 1) AS "exists"',
    )
  })

  it("checks the rows that a later filter chooses, and keeps its value on coalesce", () => {
    const expected = compile(from(post).where({ title: "First" }).exists())

    expect(compile(from(post).exists().where({ title: "First" }).orderBy("title"))).toEqual(
      expected,
    )
    expect(compile(from(post).where({ title: "First" }).exists().coalesce(false))).toEqual(expected)
  })

  it("rejects a change of the selection or the value, an aggregate, and exists, also after the methods that keep its value", () => {
    // Types reject these calls, which a query held as any query can still make.
    for (const query of [
      from(post).exists(),
      from(post).exists().where({ title: "First" }).coalesce(false),
    ] as AnySelectQuery[]) {
      for (const [method, call] of [
        ["select", () => query.select("id")],
        ["clearSelect", () => query.clearSelect()],
        ["get", () => query.get("title")],
        ["pluck", () => query.pluck("title")],
        ["count", () => query.count()],
        ["max", () => query.max("title")],
        ["exists", () => query.exists()],
      ] as const) {
        expect(call).toThrow(`${method} cannot be used after exists`)
      }
    }
  })
})

describe("coalesce", () => {
  it("replaces NULL of the value of get and pluck with a value that its type encodes, keeping a missing row", () => {
    expect(from(post).pluck("createdAt").coalesce(new Date(0)).toSQL()).toEqual({
      text: 'SELECT coalesce("post"."created_at", $1) AS "createdAt" FROM "post" AS "post"',
      parameters: [t.timestamptz.encode(new Date(0))],
    })
    expect(compile(from(post).get("title").optional().coalesce("Untitled"))).toMatchObject({
      text: 'SELECT coalesce("post"."title", $1) AS "title" FROM "post" AS "post" LIMIT 1',
      rows: "optional",
      value: true,
    })
  })

  it("replaces NULL of an aggregate after its earlier fallbacks, also of a page", () => {
    const query = from(post)
      .limit(5)
      .max("title")
      .coalesce(sql(t.text)`'none'`)
      .coalesce("unknown")

    expect(query.toSQL()).toEqual({
      text: `SELECT coalesce(max("subquery"."value"), 'none', $1) AS "max" FROM (SELECT "post"."title" AS "value" FROM "post" AS "post" LIMIT $2) AS "subquery"`,
      parameters: ["unknown", "5"],
    })
    expect(from(post).limit(2).count().coalesce(0).toSQL()).toEqual({
      text: 'SELECT coalesce(count(*), $1) AS "count" FROM (SELECT FROM "post" AS "post" LIMIT $2) AS "subquery"',
      parameters: ["0", "2"],
    })
  })

  it("takes the value of a query of one value as a scalar subquery", () => {
    const query = from(post)
      .max("title")
      .coalesce(from(post).where({ id: "post-id" }).get("title"))

    expect(query.toSQL()).toEqual({
      text: 'SELECT coalesce(max("post"."title"), (SELECT "post_2"."title" AS "title" FROM "post" AS "post_2" WHERE "post_2"."id" = $1 LIMIT 1)) AS "max" FROM "post" AS "post"',
      parameters: ["post-id"],
    })
  })

  it("rejects a query of records and a fallback of null", () => {
    // Types reject these calls, which a query held as any query can still make.
    const records: AnySelectQuery = from(post)

    expect(() => records.coalesce("Untitled")).toThrow(
      "coalesce applies only to a query of values, such as one made by get, pluck, or an aggregate",
    )
    expect(() =>
      from(post)
        .pluck("title")
        .coalesce(null as never),
    ).toThrow("coalesce takes a value other than null")
  })
})

describe("expr", () => {
  it("gives an expression of the value of a query, with the operators of its type that encode a value with it", () => {
    const later = from(post).where(() => from(post).max("createdAt").expr().lt(new Date(0)))
    const titled = from(post).where(() => from(post).get("title").expr().ilike("first%"))

    expect(later.toSQL()).toEqual({
      text: 'SELECT FROM "post" AS "post" WHERE (SELECT max("post_2"."created_at") AS "max" FROM "post" AS "post_2") < $1',
      parameters: [t.timestamptz.encode(new Date(0))],
    })
    expect(titled.toSQL()).toEqual({
      text: 'SELECT FROM "post" AS "post" WHERE (SELECT "post_2"."title" AS "title" FROM "post" AS "post_2" LIMIT 1) ILIKE $1',
      parameters: ["first%"],
    })
  })

  it("gives a count the operators of ordering", () => {
    const query = from(post).where(() => from(post).count().expr().gt(3))

    expect(query.toSQL()).toEqual({
      text: 'SELECT FROM "post" AS "post" WHERE (SELECT count(*) AS "count" FROM "post" AS "post_2") > $1',
      parameters: ["3"],
    })
  })

  it("gives EXISTS of a query of exists, also after coalesce", () => {
    const query = from(post).where(() => from(post).exists().coalesce(false).expr().eq(true))

    expect(query.toSQL()).toEqual({
      text: 'SELECT FROM "post" AS "post" WHERE EXISTS (SELECT FROM "post" AS "post_2") = $1',
      parameters: ["t"],
    })
  })

  it("keeps the fallback of coalesce and the operand of an operator", () => {
    const query = from(post).where(columns =>
      from(post).max("title").coalesce("none").expr().eq(columns.title),
    )

    expect(query.toSQL()).toEqual({
      text: 'SELECT FROM "post" AS "post" WHERE (SELECT coalesce(max("post_2"."title"), $1) AS "max" FROM "post" AS "post_2") = "post"."title"',
      parameters: ["none"],
    })
  })

  it("selects an expression with the type of the value", () => {
    const query = compile(
      from(post).select(() => ({
        total: from(post).count().expr(),
      })),
    )

    expect(query.fields).toMatchObject([{ key: "total", type: countType }])
  })

  it("rejects a query of records and of an array of values", () => {
    // Types reject these calls, which a query held as any query can still make.
    const records: AnySelectQuery = from(post).take()
    const values: AnySelectQuery = from(post).pluck("title")

    const message =
      "An expression takes a query of one value, such as of get, an aggregate, or exists, not a query of records or of an array"
    expect(() => records.expr()).toThrow(message)
    expect(() => values.expr()).toThrow(message)
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

  it("reject a query of one row, naming the method", () => {
    // Types reject these calls, which a query held as any query can still make.
    const query: AnySelectQuery = from(post).take()

    expect(() => query.limit(1)).toThrow("limit applies only to a query of many rows")
    expect(() => query.offset(1)).toThrow("offset applies only to a query of many rows")
  })
})

describe("distinct", () => {
  const selected = from(post).select("title").distinct()

  it("removes the duplicates of the rows, comparing the fields selected before or after it", () => {
    const text = 'SELECT DISTINCT "post"."title" AS "title" FROM "post" AS "post"'

    expect(selected.toSQL().text).toBe(text)
    expect(from(post).distinct().select("title").toSQL().text).toBe(text)
    expect(selected.distinct().toSQL().text).toBe(text)
  })

  it("compares the value of get and pluck, which replace the fields before them", () => {
    const values = selected.select("id")

    expect(values.pluck("title").toSQL().text).toBe(
      'SELECT DISTINCT "post"."title" AS "title" FROM "post" AS "post"',
    )
    expect(values.get("title").toSQL().text).toBe(
      'SELECT DISTINCT "post"."title" AS "title" FROM "post" AS "post" LIMIT 1',
    )
  })

  it("keeps the filters, the limit, and the offset, and leaves the query it derives from unchanged", () => {
    const base = from(post).where({ title: "First" }).select("title").limit(10).offset(20)

    expect(base.distinct().toSQL()).toEqual({
      text: 'SELECT DISTINCT "post"."title" AS "title" FROM "post" AS "post" WHERE "post"."title" = $1 LIMIT $2 OFFSET $3',
      parameters: ["First", "10", "20"],
    })
    expect(base.toSQL().text).toStartWith('SELECT "post"."title"')
  })

  it("rejects a query of one row, which must find a second row to reject it", () => {
    // Types reject these calls, which a query held as any query can still make.
    const queries: AnySelectQuery[] = [
      from(post).take(),
      from(post).find("id"),
      from(post).get("title"),
      from(post).count(),
      from(post).exists(),
    ]

    for (const query of queries) {
      expect(() => query.distinct()).toThrow("distinct applies only to a query of many rows")
    }
  })

  it("keeps the fields that it compares in the aggregate methods and exists, which replace them", () => {
    for (const query of [
      selected.count(),
      selected.max("title"),
      selected.exists(),
      selected.take().count().coalesce(0),
    ]) {
      expect(query.node.distinctFields).toBe(selected.node.projections)
    }
    expect(from(post).select("title").count().node.distinctFields).toBeUndefined()
  })

  it("rejects distinctOn before or after it", () => {
    expect(() => selected.distinctOn("title")).toThrow(
      "distinctOn cannot be used after distinct, which compares every selected field",
    )
    expect(() => from(post).distinctOn("title").select("title").distinct()).toThrow(
      "distinct cannot be used after distinctOn, which compares only its keys",
    )
  })
})

describe("distinctOn", () => {
  it("keeps the first row of each group of the keys of column keys and of callbacks, after the keys of earlier calls", () => {
    const query = from(post)
      .distinctOn("title")
      .distinctOn(columns => columns.createdAt)
      .orderBy("title", "createdAt", "id")
      .select("id")

    expect(query.toSQL().text).toBe(
      'SELECT DISTINCT ON ("post"."title", "post"."created_at") "post"."id" AS "id" FROM "post" AS "post" ORDER BY "post"."title", "post"."created_at", 1',
    )
  })

  it("compiles a key of a selected field, of the value of pluck, and of the columns after map as the position of its projection, with the parameters in the order of the text", () => {
    const days = from(post)
      .select(columns => ({
        day: sql(t.text)`date_trunc(${"day"}, ${columns.createdAt})::text`,
        id: columns.id,
      }))
      .distinctOn((_columns, selected) => selected.day)
      .orderBy((columns, selected) => [selected.day, desc(columns.createdAt)])
      .where({ title: "First" })

    expect(days.toSQL()).toEqual({
      text: 'SELECT DISTINCT ON (1) date_trunc($1, "post"."created_at")::text AS "day", "post"."id" AS "id" FROM "post" AS "post" WHERE "post"."title" = $2 ORDER BY 1, "post"."created_at" DESC',
      parameters: ["day", "First"],
    })
    expect(
      from(post)
        .pluck("title")
        .distinctOn((_columns, title) => title)
        .toSQL().text,
    ).toBe('SELECT DISTINCT ON (1) "post"."title" AS "title" FROM "post" AS "post"')
    expect(
      from(post)
        .select("id", "title")
        .map(row => row.id)
        .distinctOn(columns => columns.title)
        .toSQL().text,
    ).toBe(
      'SELECT DISTINCT ON (2) "post"."id" AS "id", "post"."title" AS "title" FROM "post" AS "post"',
    )
  })

  it("rejects a call without keys and a field of nested rows or of a literal as a key", () => {
    const query = from(post).select(() => ({
      titles: from(post).pluck("title"),
      kind: literal("post"),
    }))

    expect(() => from(post).distinctOn()).toThrow("distinctOn requires at least one key")
    expect(() => from(post).distinctOn(() => [])).toThrow("distinctOn requires at least one key")
    expect(() => query.distinctOn((_columns, selected) => selected.titles)).toThrow(
      'Field "titles" holds nested rows and cannot be a key of distinctOn',
    )
    expect(() => query.distinctOn((_columns, selected) => selected.kind)).toThrow(
      'Field "kind" holds a literal and cannot be a key of distinctOn',
    )
  })

  it("rejects a query of one row, which must find a second row to reject it", () => {
    // Types reject these calls, which a query held as any query can still make.
    const queries: AnySelectQuery[] = [
      from(post).take(),
      from(post).find("id"),
      from(post).get("title"),
      from(post).count(),
      from(post).exists(),
    ]

    for (const query of queries) {
      expect(() => query.distinctOn("title")).toThrow(
        "distinctOn applies only to a query of many rows",
      )
    }
  })

  it("keeps the fields that its keys and order may read in the aggregate methods and exists, which replace them", () => {
    const query = from(post).distinctOn("title").orderBy("title").select("id")

    for (const aggregate of [query.count(), query.stringAgg("title", ", "), query.exists()]) {
      expect(aggregate.node.distinctFields).toBe(query.node.projections)
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
      "nullable applies only to a query of records; use optional after get, pluck, or an aggregate",
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
