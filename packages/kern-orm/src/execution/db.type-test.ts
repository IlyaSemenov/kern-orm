import { describe, expectTypeOf, test } from "bun:test"

import { createRecordingDriver } from "../../testing/recording-driver"
import type { SelectQueryKind } from "../query/kind"
import type { InitialQueryState, QueryOfState, SelectQuery } from "../query/select"
import { from } from "../query/select"
import { many, one } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { createDatabase } from "./database"
import type { DbOf } from "./db"

const post = defineTable("post", {
  id: t.uuid.primaryKey(),
  title: t.text,
})
const other = defineTable("other", {
  id: t.uuid,
})
const schema = defineSchema({ post })
const database = createDatabase({ driver: createRecordingDriver().driver })
const db = database.bind(schema)

describe("$execute and $compile", () => {
  test("accept a union of queries and give the union of their results", () => {
    const pick = (optional: boolean) =>
      optional ? schema.post.get("title").optional() : schema.post.get("title")

    expectTypeOf(db.$execute(pick(true))).toEqualTypeOf<Promise<string | undefined>>()
    db.$compile(pick(true))
  })

  test("accept a query of either kind", () => {
    const posts: SelectQuery<InitialQueryState<typeof post>, SelectQueryKind> = db.post

    expectTypeOf(db.$execute(posts.select("id"))).toEqualTypeOf<Promise<{ id: string }[]>>()
    db.$compile(posts)
  })

  test("reject a query over a table outside the schema", () => {
    // @ts-expect-error The schema has no table `other`.
    void db.$execute(from(other))
    // @ts-expect-error The schema has no table `other`.
    db.$compile(from(other))
  })

  test("reject an object that is not a query, such as a copy of a query", () => {
    const imitation = { types: schema.post.types }
    const { node, ...withoutNode } = schema.post
    const { db: postDb, ...withoutDb } = db.post
    void [node, postDb]
    const view: QueryOfState<typeof schema.post.types> = schema.post

    // @ts-expect-error Only a query executes.
    void db.$execute(imitation)
    // @ts-expect-error Only a query compiles.
    db.$compile(imitation)
    // @ts-expect-error A copy of a query is not a query.
    void db.$execute(withoutNode)
    // @ts-expect-error A copy of a query is not a query.
    db.$compile(withoutDb)
    // @ts-expect-error A copy of a query is not a query.
    void db.$execute({ ...schema.post })
    // @ts-expect-error A copy of a query is not a query.
    db.$compile({ ...view })
  })
})

describe("relations", () => {
  const comment = defineTable("comment", {
    id: t.uuid,
    postId: t.uuid,
  })
  const blog = defineSchema({ post, comment }).$relations({
    post: {
      comments: many(comment, { from: "id", to: "postId" }),
    },
  })
  type BlogDb = DbOf<typeof blog>

  test("give the queries of a table the relations of the schema", () => {
    const blogDb = database.bind(blog)

    expectTypeOf(blogDb.post.types).toEqualTypeOf(blog.post.types)
  })

  test("execute a query of the relations of the schema, of a schema it includes, or of none", () => {
    const moderated = defineSchema(blog).$relations({
      comment: {
        post: one(post, { from: "postId", to: "id" }),
      },
    })
    const withComments = blog.post.select(post => ({
      comments: post.comments.select("id"),
    }))

    expectTypeOf(database.bind(moderated).$execute(withComments)).toEqualTypeOf<
      Promise<{ comments: { id: string }[] }[]>
    >()
    database.bind(blog).$compile(withComments)
    database.bind(defineSchema({ post, comment })).$execute(blog.post.select("id"))
  })

  test("reject a query of a relation that the schema lacks, also in a nested query", () => {
    const plainDb = database.bind(defineSchema({ post, comment }))
    const nested = blog.post.select(post => ({
      comments: post.comments.select(() => ({
        posts: blog.post.select(post => ({
          comments: post.comments,
        })),
      })),
    }))

    void plainDb.$execute(
      // @ts-expect-error The schema has no relation `post.comments`.
      blog.post.select(post => ({
        comments: post.comments,
      })),
    )
    // @ts-expect-error The schema has no relation `post.comments`.
    plainDb.$compile(nested)
  })

  test("let a Db of a schema that includes another one serve as a Db of that schema", () => {
    const moderated = defineSchema(blog).$relations({
      comment: {
        post: one(post, { from: "postId", to: "id" }),
      },
    })

    const blogDb: BlogDb = database.bind(moderated)
    // @ts-expect-error The schema lacks the relations of the blog.
    const plainDb: BlogDb = database.bind(defineSchema({ post, comment }))
    void [blogDb, plainDb]
  })
})
