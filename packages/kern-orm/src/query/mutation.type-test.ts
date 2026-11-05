import { describe, expectTypeOf, test } from "bun:test"

import { createRecordingDriver } from "../../testing/recording-driver"
import { createDatabase } from "../execution/database"
import { sql } from "../expression/sql"
import { many, one } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { ResultOf } from "./select"
import type { InsertValues, UpdateSet, UpdateValues } from "./values"

const post = defineTable("post", {
  id: t.uuid.primaryKey().hasDefault(),
  title: t.text,
  subtitle: t.text.nullable(),
  publishedAt: t.timestamptz.hasDefault(),
  commentCount: t.integer.nullable(),
  hasComments: t.boolean.nullable(),
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
      "id" | "title" | "subtitle" | "publishedAt" | "commentCount" | "hasComments"
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

  test("take literals of the values of their columns in a callback", () => {
    const article = defineTable("article", {
      id: t.uuid.primaryKey(),
      status: t.enum("article_status", ["draft", "live"]),
      history: t.array(t.enum("article_status", ["draft", "live"])),
    })
    const found = defineSchema({ article }).article.find("article-id")
    const published = true as boolean

    found.update(() => ({ status: "live" }))
    found.update(() => ({ status: published ? "live" : "draft" }))
    found.update(() => ({ history: ["draft", "live"] }))
    found.update(columns => ({ status: "live", history: columns.history }))

    // @ts-expect-error A literal of other values is rejected.
    found.update(() => ({ status: "archived" }))
    // @ts-expect-error A literal of other values is rejected.
    found.update(columns => ({ status: "archived", history: columns.history }))
  })

  test("take a query of one value of the values of their columns", () => {
    blog.post.insert({ title: "Hello", subtitle: blog.comment.get("id") })
    blog.post.insert({ title: blog.comment.min("id").coalesce("Hello") })
    // A column that is not nullable takes a query that is `NULL` without its row, which PostgreSQL rejects.
    blog.post.insert({ title: blog.comment.get("id") })
    blog.post.find("post-id").update({ title: blog.comment.get("id") })
    blog.post.insertMany([{ title: "Hello", subtitle: blog.comment.max("id") }])
    blog.post.find("post-id").update({ subtitle: blog.comment.get("id") })
    blog.post.find("post-id").update(() => ({
      subtitle: blog.comment.get("id"),
    }))

    // @ts-expect-error A query of other values is rejected.
    blog.post.insert({ title: blog.comment.exists() })
    // @ts-expect-error A query of an array is not of one value.
    blog.post.find("post-id").update({ subtitle: blog.comment.pluck("id") })
    // @ts-expect-error A query of records is not of one value.
    blog.post.find("post-id").update({ subtitle: blog.comment.select("id") })
  })

  test("take a query of a relation of the changed rows in a callback", () => {
    blog.post.find("post-id").update(columns => ({
      subtitle: columns.comments.get("id"),
      commentCount: columns.comments.count(),
      hasComments: columns.comments.exists(),
    }))
    blog.comment.where({ postId: "post-id" }).update(columns => ({
      postId: columns.post.get("id"),
    }))

    // A column that is not nullable takes a query that is `NULL` without its row, which PostgreSQL rejects.
    blog.post.find("post-id").update(columns => ({
      title: columns.comments.get("id"),
    }))
    // @ts-expect-error A query of other values is rejected.
    blog.post.find("post-id").update(columns => ({ title: columns.comments.exists() }))
    // @ts-expect-error A query of an array is not of one value.
    blog.post.find("post-id").update(columns => ({ subtitle: columns.comments.pluck("id") }))
    // @ts-expect-error A query of records is not of one value.
    blog.post.find("post-id").update(columns => ({ subtitle: columns.comments.select("id") }))
  })

  test("take the values of update as a variable of its argument", () => {
    const set: UpdateSet<typeof post, (typeof blog.post)["types"]["schema"]> = {
      title: "Hello",
    }

    blog.post.find("post-id").update(set)
  })

  test("reject a key that is not a column", () => {
    // @ts-expect-error Not a column.
    blog.post.insert({ title: "Hello", body: "World" })
    // @ts-expect-error Not a column.
    blog.post.find("post-id").update({ body: "World" })
    // @ts-expect-error Not a column.
    blog.post.find("post-id").update(columns => ({ body: columns.title }))
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

  test("are the values of queries of one value in callbacks", () => {
    expectTypeOf(
      db.post
        .find("post-id")
        .update({ title: "Hello" })
        .get(columns => columns.comments.count()),
    ).resolves.toEqualTypeOf<number>()
    expectTypeOf(
      db.post
        .all()
        .delete()
        .pluck(columns => columns.comments.get("id")),
    ).resolves.toEqualTypeOf<(string | null)[]>()
    expectTypeOf(
      db.comment
        .insert({ id: "comment-id", postId: "post-id" })
        .get(columns => columns.post.get("title")),
    ).resolves.toEqualTypeOf<string>()
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

  test("add the relations of the queries of values to the state, which a Db must have", () => {
    const other = createDatabase({ driver: createRecordingDriver().driver }).bind(
      defineSchema({ post, comment }),
    )
    const updated = blog.post.find("post-id").update(columns => ({
      commentCount: columns.comments.count(),
      subtitle: "Hello",
    }))
    const byExpression = blog.post.find("post-id").update(columns => ({
      commentCount: columns.comments.count().expr(),
    }))
    const returned = blog.post
      .find("post-id")
      .delete()
      .get(columns => columns.comments.count())
    const plucked = blog.post
      .all()
      .delete()
      .pluck(columns => columns.comments.count())

    expectTypeOf(db.$execute(updated)).resolves.toEqualTypeOf<number>()
    expectTypeOf(db.$execute(returned)).resolves.toEqualTypeOf<number>()
    // @ts-expect-error The schema of the Db lacks the relation.
    other.$execute(updated)
    // @ts-expect-error The schema of the Db lacks the relation.
    other.$execute(returned)
    // @ts-expect-error The schema of the Db lacks the relation.
    other.$execute(plucked)
    // An expression does not carry the relations of its queries, so only the `Db` that runs it rejects them.
    expectTypeOf<(typeof byExpression)["types"]["uses"]>().toBeNever()

    // The values of an annotated callback may hold a query of any relation, as may a `Selection`, so types reject them on a Db of known relations.
    const annotated = blog.post.find("post-id").update((columns): UpdateValues<typeof post> => ({
      commentCount: columns.comments.count(),
    }))
    // @ts-expect-error The annotation tells no relations.
    other.$execute(annotated)
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
