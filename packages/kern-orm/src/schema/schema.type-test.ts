import { describe, expectTypeOf, test } from "bun:test"

import { createRecordingDriver } from "../../testing/recording-driver"
import { createDatabase } from "../execution/database"
import type { EmptyRecord, InitialQueryState, SelectQuery } from "../query/select"
import { from } from "../query/select"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { Relation, SchemaContext } from "./relation"
import { many, one } from "./relation"
import { defineSchema, schemaRelations } from "./schema"

const post = defineTable("post", {
  id: t.uuid.primaryKey(),
})
const user = defineTable("user", {
  id: t.uuid.primaryKey(),
})
const posts = defineSchema({ post })

describe("defineSchema", () => {
  test("includes the tables of every part", () => {
    const schema = defineSchema(posts, { user })

    expectTypeOf(schema.$tables).toEqualTypeOf<{ post: typeof post; user: typeof user }>()
    expectTypeOf(schema.user).toEqualTypeOf<SelectQuery<InitialQueryState<typeof user>>>()
  })

  test("has no tables without parts", () => {
    expectTypeOf(defineSchema().$tables).toEqualTypeOf<EmptyRecord>()
  })

  test("gives a union of tables for a part typed as a union", () => {
    const pick = (condition: boolean) => defineSchema(condition ? posts : { user })

    expectTypeOf(pick(true).$tables).toEqualTypeOf<{ post: typeof post } | { user: typeof user }>()
  })

  test("gives no tables for an array of unknown length, only for the parts beside it", () => {
    const parts: (typeof posts | { user: typeof user })[] = [posts]

    expectTypeOf(defineSchema(...parts).$tables).toEqualTypeOf<EmptyRecord>()
    expectTypeOf(defineSchema(posts, ...parts).$tables).toEqualTypeOf<{ post: typeof post }>()
    expectTypeOf(defineSchema(...parts, { user }).$tables).toEqualTypeOf<{ user: typeof user }>()
  })

  test("rejects a part that is neither tables nor a schema", () => {
    const db = createDatabase({ driver: createRecordingDriver().driver }).bind(posts)

    // @ts-expect-error A query is not a part of a schema.
    defineSchema(posts.post)
    // @ts-expect-error A Db is not a part of a schema.
    defineSchema(db)
  })
})

describe("$relations", () => {
  const comment = defineTable("comment", {
    id: t.uuid,
    postId: t.uuid,
    authorId: t.uuid,
    position: t.integer,
    body: t.json,
  })
  const blog = defineSchema({ post, comment, user }).$relations({
    post: {
      comments: many(comment, { from: "id", to: "postId" }),
    },
    comment: {
      post: one(post, { from: "postId", to: "id" }),
    },
  })
  type BlogRelations = {
    post: { comments: Relation<"many", typeof comment, "comment", false> }
    comment: { post: Relation<"one", typeof post, "post", true> }
  }

  test("gives the queries of a table the relations of the schema", () => {
    expectTypeOf(blog[schemaRelations]).toEqualTypeOf<BlogRelations>()
    expectTypeOf(blog.post).toEqualTypeOf<
      SelectQuery<InitialQueryState<typeof post, SchemaContext<BlogRelations, "post">>>
    >()
  })

  test("gives the queries of a table without relations the type of a query of from", () => {
    expectTypeOf(blog.user).toEqualTypeOf<SelectQuery<InitialQueryState<typeof user>>>()
    expectTypeOf(blog.user).toEqualTypeOf(from(user))
  })

  test("gives the queries of a table different types in schemas of different relations", () => {
    expectTypeOf(blog.post).not.toEqualTypeOf(defineSchema({ post, comment }).post)
    expectTypeOf(blog.post).not.toEqualTypeOf(from(post))
  })

  test("types a query of a table with relations as a query of the table without them", () => {
    const posts: SelectQuery<InitialQueryState<typeof post>> = blog.post
    // @ts-expect-error A query of from lacks the relations of the schema.
    const related: typeof blog.post = from(post)
    void [posts, related]
  })

  test("adds relations to those of the schema", () => {
    const authored = blog.$relations({
      comment: {
        author: one(user, { from: "authorId", to: "id" }),
      },
    })

    expectTypeOf(authored[schemaRelations]).toEqualTypeOf<{
      post: { comments: Relation<"many", typeof comment, "comment", false> }
      comment: {
        post: Relation<"one", typeof post, "post", true>
        author: Relation<"one", typeof user, "user", true>
      }
    }>()
  })

  test("includes the relations of the parts of a schema", () => {
    const authors = defineSchema({ comment, user }).$relations({
      comment: {
        author: one(user, { from: "authorId", to: "id" }),
      },
    })

    expectTypeOf(defineSchema({ post }, blog, authors)[schemaRelations]).toEqualTypeOf<{
      post: { comments: Relation<"many", typeof comment, "comment", false> }
      comment: {
        post: Relation<"one", typeof post, "post", true>
        author: Relation<"one", typeof user, "user", true>
      }
    }>()
    expectTypeOf(defineSchema({ post })[schemaRelations]).toEqualTypeOf<EmptyRecord>()
  })

  test("gives the relations to a table under a numeric key, however it is written", () => {
    const numbered = defineSchema({ 1: post, comment })
    type NumberedRelations = {
      "1": { comments: Relation<"many", typeof comment, "comment", false> }
    }
    const comments = many(comment, { from: "id", to: "postId" })

    expectTypeOf(numbered.$relations({ 1: { comments } })[1].types.schema).toEqualTypeOf<
      SchemaContext<NumberedRelations, "1">
    >()
    expectTypeOf(numbered.$relations({ "1": { comments } })[1].types.schema).toEqualTypeOf<
      SchemaContext<NumberedRelations, "1">
    >()
  })

  test("checks a relation named as a member of Object", () => {
    blog.$relations({
      post: {
        toString: many(comment, { from: "id", to: "postId" }),
        constructor: many(comment, { from: "id", to: "postId" }),
      },
    })
    blog.$relations({
      post: {
        toString: many(comment, {
          // @ts-expect-error Posts have no column `missing`.
          from: "missing",
          to: "postId",
        }),
      },
    })
    blog.$relations({
      post: {
        // @ts-expect-error Posts have no column `missing`.
        constructor: many(comment, { from: "missing", to: "postId" }),
      },
    })
    blog.$relations({
      comment: {
        // @ts-expect-error JSON has no SQL =.
        constructor: many(comment, { from: "body", to: "postId" }),
      },
    })
  })

  test("checks a declaration made outside $relations against its table", () => {
    const comments = many(comment, { from: "missing", to: "postId" })

    blog.$relations({
      post: {
        // @ts-expect-error Posts have no column `missing`.
        comments,
      },
    })
  })

  test("rejects a relation named as a column of its table or starting with $", () => {
    blog.$relations({
      post: {
        // @ts-expect-error Posts have a column `id`.
        id: many(comment, { from: "id", to: "postId" }),
      },
    })
    blog.$relations({
      post: {
        // @ts-expect-error A relation name must not start with `$`.
        $comments: many(comment, { from: "id", to: "postId" }),
      },
    })
  })

  test("accepts a composite key of columns of SQL =", () => {
    blog.$relations({
      post: {
        authored: many(comment, { from: ["id", "id"], to: ["postId", "authorId"] }),
      },
    })
  })

  test("rejects a key that is not a column of its table", () => {
    blog.$relations({
      post: {
        comments: many(comment, {
          // @ts-expect-error Posts have no column `postId`.
          from: "postId",
          to: "id",
        }),
      },
    })
    blog.$relations({
      post: {
        comments: many(comment, {
          from: "id",
          // @ts-expect-error Comments have no column `title`.
          to: "title",
        }),
      },
    })
    blog.$relations({
      comment: {
        author: one(user, {
          from: "authorId",
          // @ts-expect-error Users have no column `email`.
          to: "email",
        }),
      },
    })
  })

  test("rejects a column without SQL = in a key", () => {
    blog.$relations({
      post: {
        comments: many(comment, {
          from: "id",
          // @ts-expect-error JSON has no SQL =.
          to: "body",
        }),
      },
    })
  })

  test("rejects keys of different numbers of columns", () => {
    blog.$relations({
      post: {
        comments: many(comment, {
          from: ["id", "id"],
          // @ts-expect-error The source key has two columns.
          to: ["postId"],
        }),
      },
    })
    blog.$relations({
      post: {
        comments: many(comment, {
          from: "id",
          // @ts-expect-error The source key has one column.
          to: ["postId"],
        }),
      },
    })
    blog.$relations({
      comment: {
        post: one(post, {
          from: ["postId", "authorId"],
          // @ts-expect-error The source key has two columns.
          to: ["id"],
        }),
      },
    })
  })

  test("rejects a target or a table key outside the schema", () => {
    const tag = defineTable("tag", {
      id: t.uuid,
    })

    blog.$relations({
      post: {
        // @ts-expect-error The schema has no table `tag`.
        tags: many(tag, { from: "id", to: "id" }),
      },
    })
    blog.$relations({
      // @ts-expect-error The schema has no table key `tag`.
      tag: {},
    })
    blog.$relations({
      post: {},
      // @ts-expect-error The schema has no table key `tag`.
      tag: {
        tags: many(tag, { from: "id", to: "id" }),
      },
    })
  })
})
