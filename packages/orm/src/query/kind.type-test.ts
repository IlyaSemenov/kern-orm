import { describe, expectTypeOf, test } from "bun:test"

import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"
import { createDatabase } from "kern-db"

import { bindSchema } from "../execution/db"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { SelectQueryKind } from "./kind"
import type { QueryResult } from "./rows"
import type { AnySelectQuery, SelectQuery } from "./select"
import { from } from "./select"
import type { InitialQueryState } from "./state"

const post = defineTable("post", {
  id: t.uuid,
  title: t.text,
})

const db = bindSchema(
  defineSchema({ post }),
  createDatabase({ driver: createRecordingDriver().driver }),
)

/** Result of executing query `Q`. */
type Executed<Q extends AnySelectQuery> = QueryResult<Q["types"]>

describe("kinds", () => {
  /** Query of posts that is either unbound or bound. */
  type EitherPosts = SelectQuery<InitialQueryState<typeof post>, SelectQueryKind>

  test("chain query methods on a query of either kind", () => {
    const posts: EitherPosts = db.post
    const ids = posts.where({ title: "First" }).select("id").take()
    expectTypeOf<Executed<typeof ids>>().toEqualTypeOf<{ id: string }>()
    const titles = posts.pluck("title")
    expectTypeOf<Executed<typeof titles>>().toEqualTypeOf<string[]>()

    const any: AnySelectQuery = from(post)
    any.where({}).select("id").get("title").optional()
  })

  test("chain query methods on a union of a bound and an unbound query as on a query of either kind", () => {
    const pick = (bound: boolean) => (bound ? db.post : from(post))

    const ids = pick(true).where({ title: "First" }).select("id").take()
    expectTypeOf(ids).toEqualTypeOf<SelectQuery<typeof ids.types, SelectQueryKind>>()
    expectTypeOf<Executed<typeof ids>>().toEqualTypeOf<{ id: string }>()
  })

  test("reject awaiting a query of either kind, which may execute", async () => {
    const posts: EitherPosts = from(post)

    // @ts-expect-error A query of either kind may execute when awaited.
    await posts
    // @ts-expect-error A query of either kind may execute when returned from an async function.
    void (async () => posts)()
  })

  test("keep the kind through a function generic over it", () => {
    const withTitle = <Kind extends SelectQueryKind>(
      query: SelectQuery<InitialQueryState<typeof post>, Kind>,
    ) => query.where({ title: "First" }).select("title")

    const bound = withTitle(db.post)
    expectTypeOf<Awaited<typeof bound>>().toEqualTypeOf<{ title: string }[]>()
    const unbound = withTitle(from(post))
    expectTypeOf<Awaited<typeof unbound>>().toEqualTypeOf<typeof unbound>()
  })
})

describe("catch and finally", () => {
  test("give a Promise of the result of a bound query of each class, for catch also of the result of its callback", () => {
    const posts = db.post.select("id")
    expectTypeOf(posts.catch()).toEqualTypeOf<Promise<{ id: string }[]>>()
    expectTypeOf(posts.catch(() => null)).toEqualTypeOf<Promise<{ id: string }[] | null>>()
    expectTypeOf(posts.catch(async (error: unknown) => String(error))).toEqualTypeOf<
      Promise<{ id: string }[] | string>
    >()
    expectTypeOf(posts.catch<null>(() => null)).toEqualTypeOf<Promise<{ id: string }[] | null>>()
    expectTypeOf(posts.finally()).toEqualTypeOf<Promise<{ id: string }[]>>()
    expectTypeOf(posts.finally(() => {})).toEqualTypeOf<Promise<{ id: string }[]>>()

    const count = db.post.pluck("id").transform(ids => ids.length)
    expectTypeOf(count.catch(() => null)).toEqualTypeOf<Promise<number | null>>()
    expectTypeOf(count.finally()).toEqualTypeOf<Promise<number>>()

    const record = db.$select({
      title: db.post.take().get("title"),
    })
    expectTypeOf(record.catch(() => null)).toEqualTypeOf<Promise<{ title: string } | null>>()
    expectTypeOf(record.finally()).toEqualTypeOf<Promise<{ title: string }>>()

    const inserted = db.post.insert({ id: "x", title: "First" })
    expectTypeOf(inserted.catch(() => null)).toEqualTypeOf<Promise<number | null>>()
    expectTypeOf(inserted.finally()).toEqualTypeOf<Promise<number>>()
  })

  test("apply to a union of bound queries of different states and classes, as those of a union of Promises do", () => {
    const pick = (one: boolean) => (one ? db.post.select("id").take() : db.post.select("id"))
    expectTypeOf(pick(true).catch(() => null)).toEqualTypeOf<
      Promise<{ id: string } | null> | Promise<{ id: string }[] | null>
    >()
    expectTypeOf(pick(true).finally()).toEqualTypeOf<
      Promise<{ id: string }> | Promise<{ id: string }[]>
    >()

    const change = (remove: boolean) => (remove ? db.post.delete() : db.post.pluck("title"))
    expectTypeOf(change(true).catch(() => null)).toEqualTypeOf<
      Promise<number | null> | Promise<string[] | null>
    >()
    expectTypeOf(change(true).finally()).toEqualTypeOf<Promise<number> | Promise<string[]>>()
  })

  test("reject an unbound query and a query of either kind, which a Db executes with $execute", () => {
    const unbound = from(post)
    // @ts-expect-error An unbound query has no catch.
    void unbound.catch()
    // @ts-expect-error An unbound query has no finally.
    void unbound.finally()

    const either: SelectQuery<InitialQueryState<typeof post>, SelectQueryKind> = db.post
    // @ts-expect-error A query of either kind may be unbound.
    void either.catch()
    // @ts-expect-error A query of either kind may be unbound.
    void either.finally()
  })

  test("fit the members of a Promise for a bound query alone, which is no Promise", () => {
    const posts = db.post.select("id")
    type Posts = { id: string }[]

    expectTypeOf(posts).toExtend<PromiseLike<Posts>>()
    expectTypeOf(posts).toExtend<Pick<Promise<Posts>, "then" | "catch" | "finally">>()
    // A query executes with each call of then, catch, and finally, so it is no Promise.
    expectTypeOf(posts).not.toExtend<Promise<Posts>>()

    expectTypeOf(from(post)).not.toExtend<Pick<Promise<unknown>, "catch">>()
    expectTypeOf(from(post)).not.toExtend<Pick<Promise<unknown>, "finally">>()
    type EitherPosts = SelectQuery<InitialQueryState<typeof post>, SelectQueryKind>
    expectTypeOf<EitherPosts>().not.toExtend<Pick<Promise<unknown>, "catch">>()
    expectTypeOf<EitherPosts>().not.toExtend<Pick<Promise<unknown>, "finally">>()
  })
})
