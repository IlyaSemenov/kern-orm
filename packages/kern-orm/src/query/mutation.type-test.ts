import { describe, expectTypeOf, test } from "bun:test"

import { createRecordingDriver } from "../../testing/recording-driver"
import { createDatabase } from "../execution/database"
import { sql } from "../expression/sql"
import { many, one } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { ResultOf } from "./select"
import type { InsertValues } from "./values"

const post = defineTable("post", {
  id: t.uuid.primaryKey().hasDefault(),
  title: t.text,
  subtitle: t.text.nullable(),
  publishedAt: t.timestamptz.hasDefault(),
})

const comment = defineTable("comment", {
  id: t.uuid.primaryKey(),
  postId: t.uuid,
})

const blog = defineSchema({ post, comment }).$relations({
  post: {
    comments: many(comment, { from: "id", to: "postId" }),
  },
  comment: {
    post: one(post, { from: "postId", to: "id", required: true }),
  },
})

const db = createDatabase({ driver: createRecordingDriver().driver }).bind(blog)

describe("values", () => {
  test("require the columns without a default that are not nullable", () => {
    expectTypeOf<keyof InsertValues<typeof post>>().toEqualTypeOf<
      "id" | "title" | "subtitle" | "publishedAt"
    >()

    blog.post.insert({ title: "Hello" })
    blog.post.insert({ title: "Hello", subtitle: null, publishedAt: new Date(), id: undefined })
    // @ts-expect-error A column without a default that is not nullable is required.
    blog.post.insert({ subtitle: "World" })
    // @ts-expect-error `undefined` omits a column, so a required column rejects it.
    blog.post.insertMany([{ title: undefined }])
    // @ts-expect-error A column that is not nullable rejects `null`.
    blog.post.insert({ title: null })
  })

  test("take expressions of the values of their columns", () => {
    blog.post.insert({ title: sql<string>`'Hello'`, subtitle: sql<string | null>`NULL` })
    blog.post.find("post-id").update(columns => ({
      subtitle: columns.title,
      title: sql(t.text)`upper(${columns.title})`,
    }))
    // @ts-expect-error A column that is not nullable rejects an expression that may be `NULL`.
    blog.post.find("post-id").update(columns => ({ title: columns.subtitle }))
    // @ts-expect-error An expression of other values is rejected.
    blog.post.insert({ title: sql<number>`1` })
  })

  test("reject a key that is not a column", () => {
    // @ts-expect-error Not a column.
    blog.post.insert({ title: "Hello", body: "World" })
    // @ts-expect-error Not a column.
    blog.post.find("post-id").update({ body: "World" })
  })
})

describe("results", () => {
  test("are the number of the changed rows without a selection", () => {
    expectTypeOf(db.post.insert({ title: "Hello" })).resolves.toEqualTypeOf<number>()
    expectTypeOf(db.post.find("post-id").delete()).resolves.toEqualTypeOf<number>()
    expectTypeOf(
      db.$execute(blog.post.where({ title: "Hello" }).update({ subtitle: null })),
    ).resolves.toEqualTypeOf<number>()
  })

  test("are the selected fields of the changed rows in their rows mode", () => {
    expectTypeOf(db.post.insertMany([{ title: "Hello" }]).select("id")).resolves.toEqualTypeOf<
      { id: string }[]
    >()
    expectTypeOf(
      db.post
        .insert({ title: "Hello" })
        .select("id")
        .select(columns => ({
          heading: columns.title,
        })),
    ).resolves.toEqualTypeOf<{ id: string; heading: string }>()
    expectTypeOf(
      db.post.find("post-id").optional().update({ title: "Hello" }).select("title"),
    ).resolves.toEqualTypeOf<{ title: string } | undefined>()
    expectTypeOf(
      db.post.find("post-id").nullable().delete().select("title"),
    ).resolves.toEqualTypeOf<{ title: string } | null>()
  })

  test("are the values of get and pluck", () => {
    expectTypeOf(db.post.insert({ title: "Hello" }).get("id")).resolves.toEqualTypeOf<string>()
    expectTypeOf(
      db.post
        .find("post-id")
        .nullable()
        .delete()
        .get(columns => columns.subtitle),
    ).resolves.toEqualTypeOf<string | null | undefined>()
    expectTypeOf(db.post.all().delete().pluck("publishedAt")).resolves.toEqualTypeOf<string[]>()
    expectTypeOf<ResultOf<ReturnType<typeof deleteTitles>>>().toEqualTypeOf<string>()
  })

  test("nest the rows of relations, which a Db must have", () => {
    const deleted = blog.comment
      .where({ postId: "post-id" })
      .delete()
      .select(columns => ({
        post: columns.post.select("title"),
      }))
    const other = createDatabase({ driver: createRecordingDriver().driver }).bind(
      defineSchema({ post, comment }),
    )

    expectTypeOf(db.$execute(deleted)).resolves.toEqualTypeOf<{ post: { title: string } }[]>()
    // @ts-expect-error The schema of the Db lacks the relation.
    other.$execute(deleted)
  })

  test("reject get of many rows and select after get or pluck", () => {
    // @ts-expect-error A mutation of many rows returns the values of pluck.
    db.post.all().delete().get("id")
    // @ts-expect-error `select` cannot follow `get`.
    db.post.insert({ title: "Hello" }).get("id").select("title")
  })
})

/** Deletes the posts of `title`, returning their titles. */
function deleteTitles(title: string) {
  return blog.post.where({ title }).delete().pluck("title")
}
