import { describe, expectTypeOf, test } from "bun:test"

import { defineTable } from "../table/table"
import * as t from "../types"

import type { QueryResult } from "./rows"
import type { AnySelectQuery, QueryStateOf, SelectQuery } from "./select"
import { from } from "./select"

const post = defineTable("post", {
  id: t.uuid,
  title: t.text,
})

/** Result of executing query `Q`. */
type Executed<Q extends AnySelectQuery> = QueryResult<Q["types"]>

describe("QueryResult", () => {
  test("gives the results of every mode that a state allows", () => {
    const pick = (optional: boolean) =>
      optional ? from(post).get("title").optional() : from(post).get("title")
    expectTypeOf<Executed<ReturnType<typeof pick>>>().toEqualTypeOf<string | undefined>()

    const rows = (single: boolean) =>
      single ? from(post).select("id").take() : from(post).select("id")
    expectTypeOf<Executed<ReturnType<typeof rows>>>().toEqualTypeOf<
      { id: string } | { id: string }[]
    >()

    const shapes = (value: boolean) => (value ? from(post).get("title") : from(post).select("id"))
    expectTypeOf<Executed<ReturnType<typeof shapes>>>().toEqualTypeOf<string | { id: string }[]>()

    const loose: SelectQuery<QueryStateOf<typeof post>> = from(post).get("title").optional()
    expectTypeOf<Executed<typeof loose>>().toBeUnknown()
    const title = loose.get("title")
    expectTypeOf<Executed<typeof title>>().toEqualTypeOf<string | undefined>()
    const titles = loose.pluck("title")
    expectTypeOf<Executed<typeof titles>>().toEqualTypeOf<string[] | string | undefined>()
  })
})
