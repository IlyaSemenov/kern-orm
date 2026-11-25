import { describe, expect, it } from "bun:test"

import { getThrownError } from "@kern-orm/test-harness/errors"
import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"
import { createDatabase } from "kern-db"

import { bindSchema } from "../execution/db"
import { defineTable } from "../table/table"
import * as t from "../types"

import { many, one } from "./relation"
import { defineSchema, schemaRelations } from "./schema"
import { defineSequence } from "./sequence"

const post = defineTable("post", {
  id: t.uuid.primaryKey(),
  title: t.text,
})

it("rejects table and sequence keys reserved for schema members", () => {
  expect(getThrownError(() => defineSchema({ $post: post }))).toEqual(
    new Error('Table key "$post" must not start with "$"'),
  )
  expect(getThrownError(() => defineSchema({ $seq: defineSequence("seq") }))).toEqual(
    new Error('Sequence key "$seq" must not start with "$"'),
  )
})

it("keeps the sequences of a part apart from its tables", () => {
  const postSeq = defineSequence("post_seq")
  const schema = defineSchema({ post, postSeq })

  expect(schema.$tables).toEqual({ post })
  expect(schema.$sequences).toEqual({ postSeq })
  expect(schema.postSeq.sequence).toBe(postSeq)
})

it("keeps the tables it was defined with", () => {
  const tables = { post }
  const snapshot = defineSchema(tables)
  tables.post = defineTable("post", {
    id: t.uuid.primaryKey(),
    title: t.text,
  })

  expect(snapshot.post.table).toBe(post)
})

it("accepts table keys that name properties of the object prototype", () => {
  expect(defineSchema({ toString: post }).toString.table).toBe(post)
  expect(defineSchema({ ["__proto__"]: post }).$tables).toEqual({ ["__proto__"]: post })
})

it("accepts a sequence key that names a property of the object prototype", () => {
  const postSeq = defineSequence("post_seq")
  const schema = defineSchema({ ["__proto__"]: postSeq })
  const db = bindSchema(schema, createDatabase({ driver: createRecordingDriver().driver }))

  expect(schema.$sequences).toEqual({ ["__proto__"]: postSeq })
  expect(db.$query`SELECT ${db["__proto__"].nextval()}`.toSQL().text).toBe(
    `SELECT nextval('"post_seq"'::regclass)`,
  )
})

describe("composition", () => {
  const comment = defineTable("comment", {
    id: t.uuid,
    postId: t.uuid,
  })
  const tag = defineTable("tag", {
    id: t.uuid,
  })
  const user = defineTable("user", {
    id: t.uuid,
  })
  const posts = defineSchema({ post, comment })

  it("includes the tables of other schemas as they are", () => {
    const schema = defineSchema(posts, { tag }, defineSchema({ user }))

    expect(schema.$tables).toEqual({ post, comment, tag, user })
    expect(schema.post.table).toBe(post)
    expect(schema.user.table).toBe(user)
  })

  it("accepts a table included under its key through several parts", () => {
    const schema = defineSchema(posts, defineSchema(posts, { user }), { post })

    expect(schema.$tables).toEqual({ post, comment, user })
  })

  it("accepts two tables of the same name under different keys", () => {
    const draft = defineTable("post", {
      id: t.uuid,
    })
    const schema = defineSchema(posts, { draft })

    expect(schema.post.table).toBe(post)
    expect(schema.draft.table).toBe(draft)
  })

  it("rejects a key of two different tables", () => {
    const otherPost = defineTable("post", {
      id: t.uuid,
    })

    expect(() => defineSchema(posts, { post: otherPost })).toThrow(
      'Table key "post" refers to two different tables',
    )
  })

  it("rejects a table under two keys", () => {
    const error = 'Table "post" is included under two keys, "post" and "article"'

    expect(() => defineSchema({ post, article: post })).toThrow(error)
    expect(() => defineSchema(posts, { article: post })).toThrow(error)
  })

  describe("sequences", () => {
    const postSeq = defineSequence("post_seq")
    const sequenced = defineSchema(posts, { postSeq })

    it("includes the sequences of other schemas as they are", () => {
      const schema = defineSchema(sequenced, { user }, defineSchema({ postSeq }))

      expect(schema.$tables).toEqual({ post, comment, user })
      expect(schema.$sequences).toEqual({ postSeq })
    })

    it("keeps its sequences in a schema of added relations", () => {
      const related = sequenced.$relations({
        comment: { post: one(post, { from: "postId", to: "id" }) },
      })

      expect(related.$sequences).toEqual({ postSeq })
      expect(related.postSeq.sequence).toBe(postSeq)
    })

    it("accepts a sequence under several keys", () => {
      const schema = defineSchema({ postSeq, articleSeq: postSeq })

      expect(schema.$sequences).toEqual({ postSeq, articleSeq: postSeq })
    })

    it("rejects a key of two different sequences", () => {
      expect(
        getThrownError(() => defineSchema(sequenced, { postSeq: defineSequence("post_seq") })),
      ).toEqual(new Error('Sequence key "postSeq" refers to two different sequences'))
    })

    it("rejects a key of a table and a sequence", () => {
      const error = new Error('Key "post" refers to both a table and a sequence')

      expect(getThrownError(() => defineSchema(posts, { post: postSeq }))).toEqual(error)
      expect(getThrownError(() => defineSchema({ post: postSeq }, posts))).toEqual(error)
    })
  })
})

describe("relations", () => {
  const comment = defineTable("comment", {
    id: t.uuid,
    postId: t.uuid,
  })
  const user = defineTable("user", {
    id: t.uuid,
    postId: t.uuid,
  })
  const posts = defineSchema({ post, comment }).$relations({
    post: {
      comments: many(comment, { from: "id", to: "postId" }),
    },
    comment: {
      post: one(post, { from: "postId", to: "id" }),
    },
  })
  const { comments } = posts[schemaRelations].post
  const { post: commentPost } = posts[schemaRelations].comment

  it("defines relations under the keys of their tables", () => {
    expect(comments).toMatchObject({
      kind: "many",
      name: "comments",
      source: post,
      target: comment,
    })
    expect(commentPost).toMatchObject({ kind: "one", name: "post", source: comment, target: post })
  })

  it("adds relations to a new schema of the same tables", () => {
    const authored = defineSchema(posts, { user }).$relations({
      post: {
        authors: many(user, { from: "id", to: "postId" }),
      },
    })

    expect(authored.$tables).toEqual({ post, comment, user })
    expect(authored[schemaRelations]).toEqual({
      post: { comments, authors: expect.objectContaining({ target: user }) },
      comment: { post: commentPost },
    })
    expect(Object.keys(posts[schemaRelations].post)).toEqual(["comments"])
  })

  it("adds no relations for a table key without declarations", () => {
    expect(posts.$relations({ post: {}, comment: undefined })[schemaRelations]).toEqual(
      posts[schemaRelations],
    )
  })

  it("rejects relations of a key outside the schema", () => {
    expect(() =>
      // @ts-expect-error The schema has no table `user`.
      posts.$relations({ user: { posts: many(post, { from: "postId", to: "id" }) } }),
    ).toThrow('Relations are declared for table key "user", which is not part of the schema')
  })

  it("includes the relations of other schemas as they are", () => {
    const schema = defineSchema({ user }, posts)

    expect(schema[schemaRelations].post.comments).toBe(comments)
    expect(schema[schemaRelations].comment.post).toBe(commentPost)
  })

  it("includes a relation that several parts include once", () => {
    const authored = defineSchema(posts, { user }).$relations({
      user: { post: one(post, { from: "postId", to: "id" }) },
    })
    const schema = defineSchema(posts, authored, defineSchema(posts))

    expect(schema[schemaRelations]).toEqual({
      post: { comments },
      comment: { post: commentPost },
      user: { post: authored[schemaRelations].user.post },
    })
  })

  it("rejects two different definitions of a relation of a table", () => {
    const otherPosts = defineSchema({ post, comment }).$relations({
      post: { comments: many(comment, { from: "id", to: "postId" }) },
    })
    const error = 'Relation "post.comments" has two different definitions'

    expect(() => defineSchema(posts, otherPosts)).toThrow(error)
    expect(() =>
      posts.$relations({ post: { comments: many(comment, { from: "id", to: "postId" }) } }),
    ).toThrow(error)
  })
})
