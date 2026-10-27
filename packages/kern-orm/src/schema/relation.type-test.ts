import { describe, expectTypeOf, test } from "bun:test"

import type { Column } from "../table/column"
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
const profile = defineTable("profile", {
  userId: t.uuid.primaryKey(),
  bio: t.text,
})
const post = defineTable("post", {
  id: t.uuid.primaryKey(),
  authorId: t.uuid,
  editorId: t.uuid.nullable(),
  authorEmail: t.text,
  groupId: t.uuid,
})
const tables = defineSchema({ user, membership, profile, post })

describe("DeclaredRelations", () => {
  test("infers a relation one required when no column from is nullable, the columns from include no key of their table, and the columns to are a key", () => {
    const relations = tables.$relations({
      post: {
        author: one(user, { from: "authorId", to: "id" }),
        authorByEmail: one(user, { from: "authorEmail", to: "email" }),
        membership: one(membership, { from: ["groupId", "authorId"], to: ["groupId", "userId"] }),
      },
    })[schemaRelations].post

    expectTypeOf(relations.author.required).toEqualTypeOf<true>()
    expectTypeOf(relations.authorByEmail.required).toEqualTypeOf<true>()
    expectTypeOf(relations.membership.required).toEqualTypeOf<true>()
  })

  test("infers a relation one not required when a column from is nullable, the columns from include a key of their table, or the columns to are more than a key", () => {
    const relations = tables.$relations({
      post: {
        editor: one(user, { from: "editorId", to: "id" }),
        author: one(user, { from: ["authorId", "authorEmail"], to: ["id", "email"] }),
      },
      user: {
        profile: one(profile, { from: "id", to: "userId" }),
      },
      profile: {
        user: one(user, { from: "userId", to: "id" }),
      },
    })[schemaRelations]

    expectTypeOf(relations.post.editor.required).toEqualTypeOf<false>()
    expectTypeOf(relations.post.author.required).toEqualTypeOf<false>()
    expectTypeOf(relations.user.profile.required).toEqualTypeOf<false>()
    expectTypeOf(relations.profile.user.required).toEqualTypeOf<false>()
  })

  test("takes required of a relation one as declared", () => {
    const relations = tables.$relations({
      post: {
        editor: one(user, { from: "editorId", to: "id", required: true }),
        author: one(user, { from: "authorId", to: "id", required: false }),
        reviewer: one(user, { from: "authorId", to: "id", required: flag }),
      },
    })[schemaRelations].post

    expectTypeOf(relations.editor.required).toEqualTypeOf<true>()
    expectTypeOf(relations.author.required).toEqualTypeOf<false>()
    expectTypeOf(relations.reviewer.required).toEqualTypeOf<boolean>()
  })

  test("infers required also where an optional required of a relation one may be missing", () => {
    const keys: { from: "editorId"; to: "id"; required?: true } = { from: "editorId", to: "id" }
    const relations = tables.$relations({
      post: {
        editor: one(user, keys),
      },
    })[schemaRelations].post

    expectTypeOf(relations.editor.required).toEqualTypeOf<boolean>()
  })

  test("infers required as boolean for a key to typed as a union or with a union in a position", () => {
    const relations = tables.$relations({
      post: {
        author: one(user, { from: "authorId", to: flag ? "id" : "email" }),
        membership: one(membership, {
          from: ["groupId", "authorId"],
          to: ["groupId", flag ? "userId" : "groupId"],
        }),
      },
    })[schemaRelations].post

    expectTypeOf(relations.author.required).toEqualTypeOf<boolean>()
    expectTypeOf(relations.membership.required).toEqualTypeOf<boolean>()
  })

  test("infers required as boolean when the type of the target or of the source does not tell its keys", () => {
    const id: Column<typeof t.uuid> = t.uuid.primaryKey()
    const account = defineTable("account", {
      id,
    })
    const comment: Table<"comment", typeof post.columns> = defineTable("comment", post.columns)
    const relations = defineSchema({ account, comment, user }).$relations({
      comment: {
        account: one(account, { from: "authorId", to: "id" }),
        author: one(user, { from: "authorId", to: "id" }),
      },
    })[schemaRelations].comment

    expectTypeOf(relations.account.required).toEqualTypeOf<boolean>()
    expectTypeOf(relations.author.required).toEqualTypeOf<boolean>()
  })

  test("infers required of a relation one to a union of tables, or of their keys, from each of them", () => {
    const labeled = defineTable("labeled", {
      id: t.uuid.primaryKey(),
      label: t.text,
    })
    const numbered = defineTable("numbered", {
      id: t.uuid.unique(),
      number: t.integer,
    })
    const owned = defineTable(
      "owned",
      {
        id: t.uuid,
        ownerId: t.uuid,
      },
      { primaryKey: ["id", "ownerId"] },
    )
    const grouped = defineTable(
      "grouped",
      {
        id: t.uuid.primaryKey(),
        groupId: t.uuid,
      },
      flag ? { unique: [["id", "groupId"]] } : undefined,
    )
    const relations = defineSchema({ labeled, numbered, owned, grouped, post }).$relations({
      post: {
        item: one(flag ? labeled : numbered, { from: "authorId", to: "id" }),
        either: one(flag ? labeled : owned, { from: "authorId", to: "id" }),
        grouped: one(grouped, { from: ["authorId", "groupId"], to: ["id", "groupId"] }),
      },
    })[schemaRelations].post

    expectTypeOf(relations.item.required).toEqualTypeOf<true>()
    expectTypeOf(relations.either.required).toEqualTypeOf<boolean>()
    expectTypeOf(relations.grouped.required).toEqualTypeOf<boolean>()
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
