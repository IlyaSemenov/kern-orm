import { expect, it } from "bun:test"

import { createRecordingDriver } from "../../testing/recording-driver"
import { subquery } from "../ast/testing"
import { sql } from "../expression/sql"
import { lower } from "../lowering/testing"
import type { AnySelectQuery } from "../query/select"
import { from, SelectQuery } from "../query/select"
import { NotFoundError } from "../result/result"
import { many } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { createDatabase } from "./database"

const post = defineTable("post", {
  id: t.uuid,
  title: t.text,
})
const comment = defineTable("comment", {
  id: t.uuid,
})
const schema = defineSchema({ post })

function connectRecorded() {
  const { driver, statements } = createRecordingDriver({ respond: () => ({ rows: [["post-id"]] }) })
  const db = createDatabase({ driver }).bind(schema, { schemaName: "app" })
  return { db, statements }
}

it("executes a table entry query when awaited", async () => {
  const { db, statements } = connectRecorded()

  const rows: { id: string }[] = await db.post.where({ title: "Draft" }).select("id")

  expect(rows).toEqual([{ id: "post-id" }])
  expect(statements).toEqual([
    {
      connection: "pool",
      text: 'SELECT "post"."id" AS "id" FROM "app"."post" AS "post" WHERE "post"."title" = $1',
      parameters: ["Draft"],
    },
  ])
})

it("decodes selected fields with the types of their expressions", async () => {
  const { driver } = createRecordingDriver({
    respond: () => ({ rows: [["post-id", "Draft", "t", "DRAFT", "5"]] }),
  })
  const db = createDatabase({ driver }).bind(schema)
  const label = t.text.transform({ decode: value => `label: ${value}` })

  const rows = await db.post.select("id").select(columns => ({
    heading: columns.title,
    isDraft: columns.title.eq("Draft"),
    label: sql(label)`upper(${columns.title})`,
    length: sql(t.integer)`length(${columns.title})`,
  }))

  expect(rows).toEqual([
    { id: "post-id", heading: "Draft", isDraft: true, label: "label: DRAFT", length: 5 },
  ])
})

it("returns the values of a query made by pluck", async () => {
  const { db } = connectRecorded()

  expect(await db.post.pluck("id")).toEqual(["post-id"])
  expect(await db.$execute(schema.post.pluck("id"))).toEqual(["post-id"])
})

it("returns the row of a query of one row or its value", async () => {
  const { db } = connectRecorded()

  expect(await db.post.select("id").take()).toEqual({ id: "post-id" })
  expect(await db.post.get("id")).toBe("post-id")
  expect(await db.$execute(schema.post.get("id").optional())).toBe("post-id")
})

it("rejects a query of one row without a row unless optional", async () => {
  const { driver } = createRecordingDriver()
  const db = createDatabase({ driver }).bind(schema)

  await expect(Promise.resolve(db.post.take())).rejects.toThrow(NotFoundError)
  await expect(db.$execute(schema.post.get("id"))).rejects.toThrow(NotFoundError)
  expect(await db.post.take().optional()).toBeUndefined()
  expect(await db.$execute(schema.post.get("id").optional())).toBeUndefined()
})

it("executes a query built by use on the Db of the query it is called on", async () => {
  const { db, statements } = connectRecorded()

  const rows = await db.post.use(posts => posts.select("id"))

  expect(rows).toEqual([{ id: "post-id" }])
  expect(statements).toMatchObject([
    { text: 'SELECT "post"."id" AS "id" FROM "app"."post" AS "post"' },
  ])
})

it("leaves unbound queries unexecuted when returned from async functions", async () => {
  const { db, statements } = connectRecorded()
  const buildQuery = async () => db.$schema.post.where({ title: "Draft" })

  expect(await buildQuery()).toBeInstanceOf(SelectQuery)
  expect(statements).toEqual([])
})

it("compiles a bound query as its Db executes it", () => {
  const { db } = connectRecorded()
  const query = db.post.where({ title: "Draft" }).select("id")

  const statement = {
    text: 'SELECT "post"."id" AS "id" FROM "app"."post" AS "post" WHERE "post"."title" = $1',
    parameters: ["Draft"],
  }

  expect(query.toSQL()).toEqual(statement)
  expect(db.$compile(query)).toEqual(statement)
})

it("resolves a schema name function on each compilation of a bound query", () => {
  let tenant = "tenant_1"
  const { driver } = createRecordingDriver()
  const db = createDatabase({ driver }).bind(schema, { schemaName: () => tenant })
  const query = db.post.select("id")

  expect(query.toSQL().text).toContain('FROM "tenant_1"."post"')
  tenant = "tenant_2"
  expect(query.toSQL().text).toContain('FROM "tenant_2"."post"')
})

it("keeps the bind options it was bound with", () => {
  const { driver } = createRecordingDriver()
  const options = { schemaName: "app" }
  const db = createDatabase({ driver }).bind(schema, options)
  options.schemaName = "other"

  expect(db.post.select("id").toSQL().text).toContain('FROM "app"."post"')
})

it("rejects compile options of a bound query", () => {
  const { db } = connectRecorded()
  const query: AnySelectQuery = db.post

  expect(() => query.toSQL({ schemaName: "other" })).toThrow(
    "A query bound to a Db compiles with the options of its Db",
  )
})

it("rejects a table outside its schema, also in a nested query", () => {
  const { db } = connectRecorded()
  const comments = from(comment).select(() => ({
    count: sql(t.bigint)`count(*)`,
  }))
  const query = db.post.select(() => ({
    commentCount: subquery(lower(comments), t.bigint),
  }))
  const error = 'Table "comment" is not part of the schema'

  // @ts-expect-error The schema has no table `comment`.
  expect(() => db.$compile(from(comment))).toThrow(error)
  expect(() => db.$compile(query)).toThrow(error)
})

it("rejects a relation outside its schema, also in a nested query, even of the same keys", () => {
  const commented = defineTable("commented", {
    id: t.uuid,
    postId: t.uuid,
  })
  const blog = defineSchema({ post, commented }).$relations({
    post: {
      comments: many(commented, { from: "id", to: "postId" }),
    },
  })
  const other = defineSchema({ post, commented }).$relations({
    post: {
      comments: many(commented, { from: "id", to: "postId" }),
    },
  })
  const db = createDatabase({ driver: createRecordingDriver().driver }).bind(blog)
  const query = other.post.select(post => ({
    comments: post.comments,
  }))
  const nested = blog.post.select(post => ({
    nested: post.comments.select(() => ({
      comments: query,
    })),
  }))
  const error = 'Relation "post.comments" is not part of the schema'

  expect(() => db.$compile(query)).toThrow(error)
  expect(() => db.$compile(nested)).toThrow(error)
  expect(
    db.$compile(
      blog.post.select(post => ({
        comments: post.comments,
      })),
    ).text,
  ).toContain('FROM "commented" AS "commented" WHERE "commented"."postId" = "post"."id"')
})

it("compiles a nested query bound to it into the statement of its parent", () => {
  const { db } = connectRecorded()
  const query = db.post.select(post => ({
    sameTitle: db.post.where(other => other.title.eq(post.title)).pluck("id"),
  }))

  expect(db.$compile(query).text).toContain(
    'FROM "app"."post" AS "post_2" WHERE "post_2"."title" = "post"."title") AS "subquery") AS "sameTitle" FROM "app"."post" AS "post"',
  )
})

it("rejects a query bound to another Db, also in a nested query", () => {
  const { db } = connectRecorded()
  const { db: otherDb } = connectRecorded()
  const nested = otherDb.post.select(() => ({
    ids: db.post.pluck("id"),
  }))

  expect(() => otherDb.$compile(db.post)).toThrow("Cannot run a query bound to another Db")
  expect(() => otherDb.$compile(nested)).toThrow('Selected field "ids" is bound to another Db')
})
