import { describe, expectTypeOf, test } from "bun:test"

import type { Table } from "../table/table"
import { defineTable } from "../table/table"
import * as t from "../types"

import { many, one } from "./relation"
import { defineSchema, schemaRelations } from "./schema"

declare const flag: boolean

const user = defineTable("user", {
  id: t.uuid.primaryKey(),
  email: t.text.unique(),
  name: t.text,
})
const membership = defineTable(
  "membership",
  {
    userId: t.uuid,
    groupId: t.uuid,
  },
  { primaryKey: ["userId", "groupId"] },
)
const post = defineTable("post", {
  id: t.uuid.primaryKey(),
  authorId: t.uuid,
  editorId: t.uuid.nullable(),
  authorEmail: t.text,
})
const tables = defineSchema({ user, membership, post })

describe("DeclaredRelations", () => {
  test("gives a relation one as not required unless it sets required", () => {
    const relations = tables.$relations({
      post: {
        author: one(user, { from: "authorId", to: "id" }),
        editor: one(user, { from: "editorId", to: "id" }),
      },
    })[schemaRelations].post

    expectTypeOf(relations.author.required).toEqualTypeOf<false>()
    expectTypeOf(relations.editor.required).toEqualTypeOf<false>()
  })

  test("takes required of a relation one as declared", () => {
    const relations = tables.$relations({
      post: {
        author: one(user, { from: "authorId", to: "id", required: true }),
        authorByEmail: one(user, { from: "authorEmail", to: "email", required: false }),
        reviewer: one(user, { from: "authorId", to: "id", required: flag }),
      },
    })[schemaRelations].post

    expectTypeOf(relations.author.required).toEqualTypeOf<true>()
    expectTypeOf(relations.authorByEmail.required).toEqualTypeOf<false>()
    expectTypeOf(relations.reviewer.required).toEqualTypeOf<boolean>()
  })

  test("gives required as boolean where an optional required of a relation one may be missing", () => {
    const keys: { from: "authorId"; to: "id"; required?: true } = { from: "authorId", to: "id" }
    const relations = tables.$relations({
      post: {
        author: one(user, keys),
      },
    })[schemaRelations].post

    expectTypeOf(relations.author.required).toEqualTypeOf<boolean>()
  })

  test("gives required of a union of declarations as the union of theirs", () => {
    const relations = tables.$relations({
      post: {
        author: flag
          ? one(user, { from: "authorId", to: "id", required: true })
          : one(user, { from: "authorId", to: "id" }),
      },
    })[schemaRelations].post

    expectTypeOf(relations.author.required).toEqualTypeOf<boolean>()
  })

  test("gives a relation many as not required", () => {
    const relations = tables.$relations({
      user: {
        posts: many(post, { from: "id", to: "authorId" }),
      },
    })[schemaRelations].user

    expectTypeOf(relations.posts.required).toEqualTypeOf<false>()
  })
})

describe("one", () => {
  test("rejects columns to that include no key of the target", () => {
    // @ts-expect-error The name of a user is not a key.
    one(user, { from: "authorEmail", to: "name" })
    // @ts-expect-error A user is one column of the primary key of a membership.
    one(membership, { from: "authorId", to: "userId" })
  })

  test("accepts columns to beyond a key, of a target whose type does not tell its keys, or of a union of tables of which one has the key", () => {
    const widened: Table<"user", typeof user.columns> = user
    const log = defineTable("log", {
      id: t.uuid,
    })

    one(user, { from: ["authorId", "authorEmail"], to: ["id", "name"] })
    one(widened, { from: "authorEmail", to: "name" })
    one(flag ? user : log, { from: "authorId", to: "id" })
  })
})
