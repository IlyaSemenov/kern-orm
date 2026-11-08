import { describe, expectTypeOf, test } from "bun:test"

import { createRecordingDriver } from "../../testing/recording-driver"
import { createDatabase } from "../execution/database"
import { sql } from "../expression/sql"
import { many, one } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { defineHelper } from "./helper"
import type { SelectQueryKind } from "./kind"
import type { ResultOf, SelectQuery } from "./select"
import type { FoundKey } from "./select-method-state"
import type { QueryStateOf } from "./state"
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

const vote = defineTable(
  "vote",
  {
    id: t.uuid.primaryKey().hasDefault(),
    postId: t.uuid,
    userId: t.uuid,
    votes: t.integer,
    note: t.text.nullable(),
  },
  { unique: [["postId", "userId"]] },
)
const votes = createDatabase({ driver: createRecordingDriver().driver }).bind(
  defineSchema({ vote }),
)

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

describe("conflicts", () => {
  const record = { postId: "post-id", userId: "user-id", votes: 1 }

  test("skip the rows that conflict, which insert returns as a missing row", () => {
    expectTypeOf(
      votes.vote.insert(record).onConflict("userId", "postId").doNothing(),
    ).resolves.toEqualTypeOf<number>()
    expectTypeOf(
      votes.vote.insert(record).onConflict().doNothing().get("id"),
    ).resolves.toEqualTypeOf<string | undefined>()
    expectTypeOf(
      votes.vote.insert(record).onConflict("id").doNothing().select("id", "votes"),
    ).resolves.toEqualTypeOf<{ id: string; votes: number } | undefined>()
    expectTypeOf(
      votes.vote.insertMany([record]).onConflict("postId", "userId").doNothing().pluck("id"),
    ).resolves.toEqualTypeOf<string[]>()
    expectTypeOf(
      votes.$execute(defineSchema({ vote }).vote.insert(record).onConflict().doNothing()),
    ).resolves.toEqualTypeOf<number>()
  })

  test("update the existing records by merge and update, returning a row of each record", () => {
    expectTypeOf(
      votes.vote.insert(record).onConflict("postId", "userId").merge("votes").get("id"),
    ).resolves.toEqualTypeOf<string>()
    expectTypeOf(
      votes.vote.insertMany([record]).onConflict("id").merge().pluck("votes"),
    ).resolves.toEqualTypeOf<number[]>()
    expectTypeOf(
      votes.vote
        .insert(record)
        .onConflict("postId", "userId")
        .update((existing, excluded) => ({
          votes: sql(t.integer)`${existing.votes} + ${excluded.votes}`,
        })),
    ).resolves.toEqualTypeOf<number>()
    expectTypeOf(
      votes.vote.insert(record).onConflict("id").update({ votes: 0 }).select("votes"),
    ).resolves.toEqualTypeOf<{ votes: number }>()
  })

  test("check the columns of merge and the values of update", () => {
    const byId = votes.vote.insert(record).onConflict("id")

    // @ts-expect-error A column of the key.
    votes.vote.insert(record).onConflict("postId", "userId").merge("userId")
    // @ts-expect-error Not a column.
    byId.merge("title")
    // @ts-expect-error A value of another type.
    byId.update({ votes: "many" })
    // @ts-expect-error An expression of another type.
    byId.update((_, excluded) => ({ votes: excluded.userId }))
  })

  test("reject merge and update of a conflict on any key", () => {
    // @ts-expect-error A conflict on any key.
    votes.vote.insert(record).onConflict().merge("votes")
    // @ts-expect-error A conflict on any key.
    votes.vote.insert(record).onConflict().update({ votes: 0 })
  })

  test("add the relations of the queries of update to the state, which a Db must have", () => {
    const other = createDatabase({ driver: createRecordingDriver().driver }).bind(
      defineSchema({ post, comment }),
    )
    const updated = blog.post
      .insert({ title: "Hello" })
      .onConflict("id")
      .update(existing => ({
        commentCount: existing.comments.count(),
      }))

    expectTypeOf(db.$execute(updated)).resolves.toEqualTypeOf<number>()
    // @ts-expect-error The schema of the Db lacks the relation.
    other.$execute(updated)
  })

  test("take the columns of exactly one key", () => {
    // @ts-expect-error Not a key.
    votes.vote.insert(record).onConflict("userId")
    // @ts-expect-error More columns than a key.
    votes.vote.insert(record).onConflict("id", "votes")
    // @ts-expect-error Not a column.
    votes.vote.insert(record).onConflict("name")
  })

  test("apply only right after insert or insertMany, once", () => {
    // @ts-expect-error Not an insert.
    votes.vote.find("vote-id").update({ votes: 2 }).onConflict()
    // @ts-expect-error Not an insert.
    votes.vote.find("vote-id").delete().onConflict()
    // @ts-expect-error After a selection.
    votes.vote.insert(record).select("id").onConflict()
    // @ts-expect-error After an action.
    votes.vote.insert(record).onConflict().doNothing().onConflict()
    // @ts-expect-error After an action.
    votes.vote.insert(record).onConflict("id").merge().onConflict()
  })

  test("need an action before the mutation runs", async () => {
    // @ts-expect-error A conflict without an action is no query to await.
    await votes.vote.insert(record).onConflict()
  })
})

describe("upsert", () => {
  const key = { postId: "post-id", userId: "user-id" }

  test("inserts or updates the record of the key of find or findBy, returning its row", () => {
    expectTypeOf(votes.vote.findBy(key).upsert({ votes: 1 })).resolves.toEqualTypeOf<number>()
    expectTypeOf(
      votes.vote
        .find("vote-id")
        .upsert({ ...key, votes: 1 })
        .get("id"),
    ).resolves.toEqualTypeOf<string>()
    expectTypeOf(
      votes.vote.findBy(key).upsert({ votes: 1, note: null }).select("id", "note"),
    ).resolves.toEqualTypeOf<{ id: string; note: string | null }>()
    expectTypeOf(
      votes.$execute(defineSchema({ vote }).vote.findBy(key).upsert({ votes: 1 })),
    ).resolves.toEqualTypeOf<number>()
  })

  test("takes the values of an insert without the columns of the key", () => {
    votes.vote.findBy(key).upsert({ votes: sql<number>`1`, note: undefined })
    // @ts-expect-error A column of the key.
    votes.vote.findBy(key).upsert({ userId: "user-id", votes: 1 })
    // @ts-expect-error A column of the key.
    votes.vote.find("vote-id").upsert({ ...key, id: "vote-id", votes: 1 })
    // @ts-expect-error A column that an insert requires.
    votes.vote.find("vote-id").upsert({ votes: 1 })
    // @ts-expect-error A value of another type.
    votes.vote.findBy(key).upsert({ votes: "many" })
    // @ts-expect-error Not a column.
    votes.vote.findBy(key).upsert({ votes: 1, title: "Hello" })
  })

  test("takes the values by the key of the query, which a query of another key does not stand for", () => {
    const item = defineTable(
      "item",
      {
        id: t.uuid.primaryKey(),
        tenantId: t.uuid,
        title: t.text,
      },
      { unique: [["tenantId", "id"]] },
    )
    const items = createDatabase({ driver: createRecordingDriver().driver }).bind(
      defineSchema({ item }),
    )
    let byId = items.item.find("item-id")
    let byTenant = items.item.findBy({ tenantId: "tenant-id", id: "item-id" })
    // @ts-expect-error A query of another key.
    byId = items.item.findBy({ tenantId: "tenant-id", id: "item-id" })
    // @ts-expect-error The query gives `id` but not `tenantId`.
    byTenant = items.item.find("item-id")
    const upsertById = (query: typeof byId) => query.upsert({ tenantId: "tenant-id", title: "A" })
    const upsertByTenant = (query: typeof byTenant) => query.upsert({ title: "A" })
    // @ts-expect-error A query of another key.
    void upsertById(items.item.findBy({ tenantId: "tenant-id", id: "item-id" }))
    // @ts-expect-error The query gives `id` but not `tenantId`.
    void upsertByTenant(items.item.find("item-id"))
    const upsertByState = (
      query: SelectQuery<QueryStateOf<typeof item> & FoundKey<"tenantId" | "id">, SelectQueryKind>,
    ) => query.upsert({ title: "A" })
    void upsertByState(items.item.findBy({ tenantId: "tenant-id", id: "item-id" }))
    // @ts-expect-error The query gives `id` but not `tenantId`.
    void upsertByState(items.item.find("item-id"))
  })

  test("applies right after find or findBy", () => {
    // @ts-expect-error Not a query of find.
    votes.vote.upsert({ ...key, votes: 1 })
    // @ts-expect-error Not a query of find.
    votes.vote.where(key).take().upsert({ votes: 1 })
    // @ts-expect-error After optional.
    votes.vote.findBy(key).optional().upsert({ votes: 1 })
    // @ts-expect-error After a selection.
    votes.vote.findBy(key).select("id").upsert({ votes: 1 })
    // @ts-expect-error After get.
    votes.vote.findBy(key).get("id").upsert({ votes: 1 })
    // @ts-expect-error After an update.
    votes.vote.findBy(key).update({ votes: 1 }).upsert({ votes: 1 })
    // @ts-expect-error After an upsert.
    votes.vote.findBy(key).upsert({ votes: 1 }).onConflict()
  })
})

describe("use", () => {
  const values = { title: "Hello" }
  const withTitle = defineHelper(blog.post, query => query.select("title"))
  type Titled = { title: string }

  test("selects what a helper selects, in the rows mode of the changed rows", () => {
    expectTypeOf(db.post.insert(values).use(withTitle)).resolves.toEqualTypeOf<Titled>()
    expectTypeOf(db.post.insertMany([values]).use(withTitle)).resolves.toEqualTypeOf<Titled[]>()
    expectTypeOf(
      db.post.find("post-id").update(values).use(withTitle),
    ).resolves.toEqualTypeOf<Titled>()
    expectTypeOf(db.post.find("post-id").optional().delete().use(withTitle)).resolves.toEqualTypeOf<
      Titled | undefined
    >()
    expectTypeOf(db.post.all().delete().use(withTitle)).resolves.toEqualTypeOf<Titled[]>()
  })

  test("adds what a helper selects to the fields selected before", () => {
    expectTypeOf(db.post.insert(values).select("id").use(withTitle)).resolves.toEqualTypeOf<{
      id: string
      title: string
    }>()
  })

  test("checks the arguments of a helper", () => {
    const withLabel = defineHelper(blog.post, (query, label: string) =>
      query.select(() => ({
        label: sql(t.text)`${label}`,
      })),
    )

    expectTypeOf(db.post.insert(values).use(withLabel, "a")).resolves.toEqualTypeOf<{
      label: string
    }>()
    // @ts-expect-error The helper takes a label.
    void db.post.insert(values).use(withLabel)
    // @ts-expect-error The label is a string.
    void db.post.insert(values).use(withLabel, 1)
  })

  test("keeps the number of the rows with a helper that selects nothing", () => {
    const same = defineHelper(blog.post, query => query)

    expectTypeOf(db.post.insert(values).use(same)).resolves.toEqualTypeOf<number>()
  })

  test("keeps the kind of the mutation", () => {
    expectTypeOf(blog.post.insert(values).use(withTitle).then).toBeUndefined()
  })

  test("applies a helper of a table, on a schema that adds relations to it", () => {
    const ofTable = defineHelper(post, query => query.select("title"))

    expectTypeOf(db.post.insert(values).use(ofTable)).resolves.toEqualTypeOf<Titled>()
  })

  test("selects the relations of a helper of a schema, which the mutation must have", () => {
    const plain = defineSchema({ post, comment })
    const withCommentIds = defineHelper(blog.post, query =>
      query.select(columns => ({
        commentIds: columns.comments.pluck("id"),
      })),
    )

    expectTypeOf(db.post.insert(values).use(withCommentIds)).resolves.toEqualTypeOf<{
      commentIds: string[]
    }>()
    // @ts-expect-error The schema has no relation `post.comments`.
    void plain.post.insert(values).use(withCommentIds)
  })

  test("applies a callback, which returns a mutation, with the result of either branch", () => {
    const returnTable = () => blog.post
    const returnFields = Boolean(values.title)
    const either = db.post
      .insert(values)
      .use(query => (returnFields ? query.select("id", "title") : query))

    expectTypeOf(db.post.insert(values).use(query => query.select("id"))).resolves.toEqualTypeOf<{
      id: string
    }>()
    expectTypeOf<Awaited<typeof either>>().toEqualTypeOf<number | { id: string; title: string }>()
    // @ts-expect-error The callback returns no mutation.
    void blog.post.insert(values).use(returnTable)
  })

  test("rejects a helper that filters or takes one row, which a mutation lacks", () => {
    const filtered = defineHelper(blog.post, query => query.where({ title: "Hello" }))
    const taken = defineHelper(blog.post, query => query.take())
    const found = defineHelper(blog.post, query => query.find("post-id"))
    const optional = defineHelper(blog.post, query => query.take().optional())

    // @ts-expect-error A mutation does not filter.
    void db.post.insert(values).use(filtered)
    // @ts-expect-error A mutation does not take one row.
    void db.post.insert(values).use(taken)
    // @ts-expect-error A mutation does not filter.
    void db.post.insert(values).use(found)
    // @ts-expect-error A mutation does not take one row.
    void db.post.insert(values).use(optional)
  })

  test("rejects a helper of another table", () => {
    const ofComment = defineHelper(comment, query => query.select("postId"))

    // @ts-expect-error The helper is of another table.
    void db.post.insert(values).use(ofComment)
  })

  test("rejects a helper that selects fields after get", () => {
    const value = db.post.insert(values).get("id")

    // @ts-expect-error `select` cannot follow `get`.
    void value.use(withTitle)
  })
})

/** Deletes the posts of `title`, returning their titles. */
function deleteTitles(title: string) {
  return blog.post.where({ title }).delete().pluck("title")
}
