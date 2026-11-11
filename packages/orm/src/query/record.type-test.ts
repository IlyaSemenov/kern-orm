import { describe, expectTypeOf, test } from "bun:test"

import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"
import { createDatabase } from "kern-db"

import { bindSchema } from "../execution/db"
import { sql } from "../expression/sql"
import { many } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { SelectQueryKind } from "./kind"
import type { RecordQuery, RecordQueryState } from "./record"
import type { ResultOf } from "./select"
import type { EmptyRecord } from "./state"

const post = defineTable("post", {
  id: t.uuid.primaryKey(),
  title: t.text,
})

const comment = defineTable("comment", {
  id: t.uuid,
  postId: t.uuid,
})

const blog = defineSchema({ post, comment }).$relations({
  post: {
    comments: many(comment, { from: "id", to: "postId" }),
  },
})

const database = createDatabase({ driver: createRecordingDriver().driver })
const db = bindSchema(blog, database)

describe("$select", () => {
  test("gives one record of the values of expressions and the results of queries", () => {
    const query = blog.$select({
      posts: blog.post.select("id"),
      post: blog.post.find("post-id").select("title").optional(),
      title: blog.post.find("post-id").get("title"),
      comments: blog.post.select(post => ({
        ids: post.comments.pluck("id"),
      })),
      count: sql(t.bigint)`1`,
      1: sql(t.text)`'one'`,
    })

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{
      posts: { id: string }[]
      post: { title: string } | undefined
      title: string
      comments: { ids: string[] }[]
      count: bigint
      "1": string
    }>()
  })

  test("executes a query of a Db when awaited, and a query of a schema with $execute", async () => {
    const titles = blog.$select({
      titles: blog.post.pluck("title"),
    })

    expectTypeOf(
      await db.$select({
        titles: db.post.pluck("title"),
      }),
    ).toEqualTypeOf<{ titles: string[] }>()
    expectTypeOf(db.$execute(titles)).toEqualTypeOf<Promise<{ titles: string[] }>>()
    expectTypeOf<Awaited<typeof titles>>().toEqualTypeOf<typeof titles>()
    db.$compile(titles)
  })

  test("rejects awaiting a query of either kind, which may execute", async () => {
    type EitherQuery = RecordQuery<RecordQueryState<EmptyRecord, never>, SelectQueryKind>
    const either: EitherQuery = blog.$select({})

    // @ts-expect-error A query of either kind may execute when awaited.
    await either
  })

  test("rejects a field that is not an expression with a type or a query", () => {
    blog.$select({
      // @ts-expect-error An expression of `sql<T>` has no type to decode its values.
      count: sql<number>`1`,
    })
    blog.$select({
      // @ts-expect-error A string is not a field.
      title: "title",
    })
  })

  test("rejects in $execute a query of a relation that the schema of the Db lacks", () => {
    const plainDb = bindSchema(defineSchema({ post, comment }), database)
    const query = blog.$select({
      posts: blog.post.select(post => ({
        comments: post.comments,
      })),
    })

    // @ts-expect-error The schema has no relation `post.comments`.
    void plainDb.$execute(query)
    db.$compile(query)
  })
})
