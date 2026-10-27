import { describe, expectTypeOf, test } from "bun:test"

import { createRecordingDriver } from "../../testing/recording-driver"
import { createDatabase } from "../execution/database"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { SelectQueryKind } from "./kind"
import type { QueryResult } from "./rows"
import type { AnySelectQuery, InitialQueryState, SelectQuery } from "./select"
import { from } from "./select"

const post = defineTable("post", {
  id: t.uuid,
  title: t.text,
})

const db = createDatabase({ driver: createRecordingDriver().driver }).bind(defineSchema({ post }))

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
