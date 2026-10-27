import { describe, expectTypeOf, test } from "bun:test"

import { createRecordingDriver } from "../../testing/recording-driver"
import { createDatabase } from "../execution/database"
import type { AnyExpression, TypedExpression } from "../expression/expression"
import type { Operand } from "../expression/operators/comparison"
import { param, sql } from "../expression/sql"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { ColumnRefs } from "./column-refs"
import type { SelectQueryKind } from "./kind"
import { desc, orderBy } from "./order"
import type { QueryResult } from "./rows"
import type {
  AnySelectQuery,
  EmptyRecord,
  InitialQueryState,
  ResultOf,
  SelectQuery,
} from "./select"
import { from } from "./select"
import type { Selection } from "./selection"

const post = defineTable("post", {
  id: t.uuid,
  title: t.text,
  hint: t.text.nullable(),
})

const db = createDatabase({ driver: createRecordingDriver().driver }).bind(defineSchema({ post }))

/** State of a query over posts of any result. */
interface AnyResultState extends InitialQueryState<typeof post> {
  // oxlint-disable-next-line typescript/no-explicit-any -- a query of any result
  readonly result: any
}

/** Result of executing query `Q`. */
type Executed<Q extends AnySelectQuery> = QueryResult<Q["types"]>

describe("select", () => {
  test("types fields by the values of the selected expressions", () => {
    const query = from(post).select(columns => ({
      heading: columns.title,
      hint: columns.hint,
      isDraft: columns.title.ilike("draft%"),
      hasHint: columns.hint.isNull(),
      upper: sql(t.text)`upper(${columns.title})`,
      length: sql(t.integer)`length(${columns.title})`,
      limit: param(t.integer, 10),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{
      heading: string
      hint: string | null
      isDraft: boolean
      hasHint: boolean
      upper: string
      length: number
      limit: number
    }>()
    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<ResultOf<typeof query>[]>()
  })

  test("adds fields to the fields selected earlier", () => {
    const query = from(post)
      .select("id")
      .select(columns => ({
        heading: columns.title,
      }))
      .select("hint")

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{
      id: string
      heading: string
      hint: string | null
    }>()

    const all = from(post)
      .select(columns => ({
        heading: columns.title,
      }))
      .select("*")
    expectTypeOf<ResultOf<typeof all>>().toEqualTypeOf<{
      heading: string
      id: string
      title: string
      hint: string | null
    }>()
  })

  test("accepts any selection on a query of any result", () => {
    const query: SelectQuery<AnyResultState> = from(post).select("id")
    query.select(() => ({
      id: sql(t.text)`'id'`,
    }))
    const chained = query.select("id").select("title")
    expectTypeOf<ResultOf<typeof chained>>().toBeAny()
  })

  test("replaces the types of selected fields and keeps the other fields", () => {
    const query = from(post).select("id", "id", "hint")
    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ id: string; hint: string | null }>()

    const replaced = query.select(() => ({
      id: sql(t.integer)`1`,
    }))
    expectTypeOf<ResultOf<typeof replaced>>().toEqualTypeOf<{ id: number; hint: string | null }>()
    const column = replaced.select("id")
    expectTypeOf<ResultOf<typeof column>>().toEqualTypeOf<{ id: string; hint: string | null }>()
    const all = replaced.select("*")
    expectTypeOf<ResultOf<typeof all>>().toEqualTypeOf<{
      id: string
      title: string
      hint: string | null
    }>()
    const bound = db.post.select("id").select(() => ({
      id: sql(t.integer)`1`,
    }))
    expectTypeOf<Awaited<typeof bound>>().toEqualTypeOf<{ id: number }[]>()

    // @ts-expect-error A type argument cannot narrow the columns of `*`.
    from(post).select<"*", "id">("*")
  })

  test("selects a field that a branch may have selected", () => {
    const pick = (withTitle: boolean) =>
      withTitle ? from(post).select("id", "title") : from(post).select("id")
    const query = pick(true).select("title")

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ id: string; title: string }>()
  })

  test("replaces numeric and string spellings of the same field", () => {
    const query = from(post)
      .select(columns => ({
        0: columns.id,
      }))
      .select(() => ({
        "0": sql(t.integer)`1`,
      }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ "0": number }>()
  })

  test("keeps the previous field when an optional selection is absent", () => {
    const fields: { id?: TypedExpression<number> } = {}
    const query = from(post)
      .select("id")
      .select(() => fields)

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ id: string | number | undefined }>()
  })

  test("keeps undefined returned by the decoder of an optional replacement", () => {
    const missing = t.text.transform({ decode: () => undefined })
    const fields: { id?: TypedExpression<undefined> } = { id: sql(missing)`1` }
    const query = from(post)
      .select("id")
      .select(() => fields)

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ id: string | undefined }>()
  })

  test("accepts only expressions with types under string keys", () => {
    // The callbacks return a `Selection`, so that the errors are reported at the fields rather than at the calls.
    from(post).select((): Selection => ({
      // @ts-expect-error A selected field is an expression.
      id: "id",
    }))
    from(post).select((columns): Selection => ({
      // @ts-expect-error A selected expression has a type to decode its values.
      length: sql<number>`length(${columns.title})`,
    }))
    const key = Symbol("id")
    from(post).select((columns): Selection => ({
      // @ts-expect-error A selected field has a string key.
      [key]: columns.id,
    }))
  })
})

describe("clearSelect", () => {
  test("clears the selected fields", () => {
    const cleared = from(post).select("id", "title").clearSelect()
    expectTypeOf<ResultOf<typeof cleared>>().toEqualTypeOf<EmptyRecord>()

    const all = cleared.select("*")
    expectTypeOf<ResultOf<typeof all>>().toEqualTypeOf<{
      id: string
      title: string
      hint: string | null
    }>()

    const anyResult: SelectQuery<AnyResultState> = from(post)
    const clearedAny = anyResult.clearSelect()
    expectTypeOf<ResultOf<typeof clearedAny>>().toEqualTypeOf<EmptyRecord>()
    const bound = db.post.select("id").clearSelect()
    expectTypeOf<Awaited<typeof bound>>().toEqualTypeOf<EmptyRecord[]>()
  })
})

describe("take", () => {
  test("returns the record of one row", () => {
    const query = from(post).select("id").take()

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ id: string }>()
    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<{ id: string }>()
    const bound = db.post.select("id").take()
    expectTypeOf<Awaited<typeof bound>>().toEqualTypeOf<{ id: string }>()
  })

  test("keeps the selection open", () => {
    const query = from(post).take().select("id").take().select("title")

    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<{ id: string; title: string }>()
  })

  test("keeps a query of one row as it is", () => {
    const query = from(post).select("id").take().optional().take()

    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<{ id: string } | undefined>()
  })
})

describe("get", () => {
  test("returns the value of a column or an expression", () => {
    const hint = from(post).get("hint")
    expectTypeOf<ResultOf<typeof hint>>().toEqualTypeOf<string | null>()
    expectTypeOf<Executed<typeof hint>>().toEqualTypeOf<string | null>()

    const isDraft = from(post).get(columns => columns.title.ilike("draft%"))
    expectTypeOf<Executed<typeof isDraft>>().toEqualTypeOf<boolean>()
    const length = from(post).get(columns => sql(t.integer)`length(${columns.title})`)
    expectTypeOf<Executed<typeof length>>().toEqualTypeOf<number>()

    const bound = db.post.get("title")
    expectTypeOf<Awaited<typeof bound>>().toEqualTypeOf<string>()
  })

  test("replaces the selected fields and an earlier value", () => {
    const query = from(post).select("id", "hint").get("hint").get("title")

    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<string>()
  })

  test("rejects a change of the selection", () => {
    const query = from(post).get("title")

    // @ts-expect-error A query of values cannot select fields.
    query.select("id")
    // @ts-expect-error A query of values cannot select fields.
    query.select(columns => ({
      id: columns.id,
    }))
    // @ts-expect-error A query of values cannot clear its selection.
    query.clearSelect()
  })

  test("is pluck followed by take", () => {
    const get = from(post).get("hint")
    const pluck = from(post).pluck("hint").take()

    expectTypeOf<Executed<typeof get>>().toEqualTypeOf<Executed<typeof pluck>>()
  })

  test("rejects without a row after nullable, since the value of a missing row is never null", () => {
    const title = from(post).take().nullable().get("title")
    expectTypeOf<Executed<typeof title>>().toEqualTypeOf<string>()
    const hint = from(post).take().nullable().get("hint")
    expectTypeOf<Executed<typeof hint>>().toEqualTypeOf<string | null>()
  })

  test("accepts only a column or an expression with a type", () => {
    // @ts-expect-error A value is a column of the table.
    from(post).get("missing")
    // @ts-expect-error A value is an expression.
    from(post).get(() => "id")
    // @ts-expect-error An expression has a type to decode its value.
    from(post).get(columns => sql<number>`length(${columns.title})`)

    const widened: AnyExpression<number> = sql<number>`1`
    // @ts-expect-error An expression widened to AnyExpression may have no type.
    from(post).get(() => widened)
    const getParameter = (value: Operand<string>) =>
      // @ts-expect-error A parameter of an operand may be an expression without a type.
      from(post).get(columns => param(columns.title, value))
    void getParameter
  })
})

describe("pluck", () => {
  test("returns the values of a column or an expression", () => {
    const hints = from(post).select("id").pluck("hint")
    expectTypeOf<ResultOf<typeof hints>>().toEqualTypeOf<string | null>()
    expectTypeOf<Executed<typeof hints>>().toEqualTypeOf<(string | null)[]>()

    const lengths = from(post).pluck(columns => sql(t.integer)`length(${columns.title})`)
    expectTypeOf<Executed<typeof lengths>>().toEqualTypeOf<number[]>()

    const bound = db.post.pluck("title")
    expectTypeOf<Awaited<typeof bound>>().toEqualTypeOf<string[]>()
  })

  test("keeps the rows mode of a query of one row", () => {
    const title = from(post).take().pluck("title")
    expectTypeOf<Executed<typeof title>>().toEqualTypeOf<string>()

    const optional = from(post).take().optional().pluck("title")
    expectTypeOf<Executed<typeof optional>>().toEqualTypeOf<string | undefined>()
  })

  test("rejects without a row after nullable, since the value of a missing row is never null", () => {
    const title = from(post).take().nullable().pluck("title")
    expectTypeOf<Executed<typeof title>>().toEqualTypeOf<string>()
    const hint = from(post).take().nullable().pluck("hint")
    expectTypeOf<Executed<typeof hint>>().toEqualTypeOf<string | null>()
  })

  test("rejects a change of the selection", () => {
    const query = from(post).pluck("title")

    // @ts-expect-error A query of values cannot select fields.
    query.select("id")
    // @ts-expect-error A query of values cannot select fields.
    query.select(columns => ({
      id: columns.id,
    }))
    // @ts-expect-error A query of values cannot clear its selection.
    query.clearSelect()
  })

  test("accepts only a column or an expression with a type", () => {
    // @ts-expect-error A value is a column of the table.
    from(post).pluck("missing")
    // @ts-expect-error A value is an expression.
    from(post).pluck(() => "id")
    // @ts-expect-error An expression has a type to decode its values.
    from(post).pluck(columns => sql<number>`length(${columns.title})`)
  })
})

describe("orderBy", () => {
  test("keeps the state of the query", () => {
    const base = from(post).select("id").take()
    const sorted = base
      .orderBy("title", { hint: "desc nulls last" })
      .orderBy(columns => [desc(columns.title), columns.id])

    expectTypeOf(sorted).toEqualTypeOf<typeof base>()
  })

  test("accepts columns with directions, also from variables", () => {
    const by = "title" as "title" | "hint"
    const direction = "desc" as "asc" | "desc"
    from(post).orderBy({ [by]: direction }, "id")

    // @ts-expect-error A key names a column.
    from(post).orderBy("heading")
    // @ts-expect-error A direction is lowercase.
    from(post).orderBy({ title: "DESC" })
  })

  test("passes the columns and the expressions of the selected fields to the callback", () => {
    from(post)
      .select("id")
      .select(columns => ({
        heading: columns.title,
        others: from(post).select("id"),
      }))
      .orderBy((columns, selected) => {
        expectTypeOf(columns).toEqualTypeOf<ColumnRefs<typeof post>>()
        expectTypeOf(selected).toEqualTypeOf<{
          readonly id: AnyExpression<string>
          readonly heading: AnyExpression<string>
          readonly others: AnyExpression<{ id: string }[]>
        }>()
        return [desc(selected.heading), orderBy(columns.hint, "asc nulls first"), sql`random()`]
      })
  })

  test("passes the expression of the value of a query of values to the callback", () => {
    from(post)
      .pluck("hint")
      .orderBy((_columns, value) => {
        expectTypeOf(value).toEqualTypeOf<AnyExpression<string | null>>()
        return desc(value)
      })
  })

  test("accepts only expressions and sort keys from the callback", () => {
    // @ts-expect-error A sort key is an expression.
    from(post).orderBy(() => "title")
    // @ts-expect-error A sort key is an expression, not the rows of a query.
    from(post).orderBy(() => [from(post).pluck("title")])
  })
})

describe("limit and offset", () => {
  test("keep the state of a query of many rows", () => {
    const base = from(post).select("id")
    expectTypeOf(base.limit(10).offset(20)).toEqualTypeOf<typeof base>()

    const second = base.offset(1).take()
    expectTypeOf<Executed<typeof second>>().toEqualTypeOf<{ id: string }>()
  })

  test("reject a query of one row", () => {
    // @ts-expect-error A query of one row has no pagination.
    from(post).take().limit(1)
    // @ts-expect-error A query of one row has no pagination.
    from(post).get("title").offset(1)
  })
})

describe("optional", () => {
  test("resolves to undefined without a row", () => {
    const record = from(post).select("id").take().optional()
    expectTypeOf<ResultOf<typeof record>>().toEqualTypeOf<{ id: string }>()
    expectTypeOf<Executed<typeof record>>().toEqualTypeOf<{ id: string } | undefined>()

    const hint = from(post).get("hint").optional()
    expectTypeOf<Executed<typeof hint>>().toEqualTypeOf<string | null | undefined>()

    const bound = db.post.get("title").optional()
    expectTypeOf<Awaited<typeof bound>>().toEqualTypeOf<string | undefined>()
  })

  test("keeps applying when the query changes", () => {
    const before = from(post).take().optional().get("title")
    const after = from(post).take().get("title").optional()

    expectTypeOf<Executed<typeof before>>().toEqualTypeOf<string | undefined>()
    expectTypeOf<Executed<typeof after>>().toEqualTypeOf<string | undefined>()
  })

  test("rejects a query of many rows", () => {
    // @ts-expect-error Only a query of one row is optional.
    from(post).optional()
  })
})

describe("nullable", () => {
  test("resolves to null without a row", () => {
    const record = from(post).select("id").take().nullable()
    expectTypeOf<Executed<typeof record>>().toEqualTypeOf<{ id: string } | null>()

    const bound = db.post.select("title").take().optional().nullable()
    expectTypeOf<Awaited<typeof bound>>().toEqualTypeOf<{ title: string } | null>()
  })

  test("keeps applying when the query selects fields", () => {
    const query = from(post).take().nullable().select("id")
    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<{ id: string } | null>()
  })

  test("rejects a query of many rows and a query of values", () => {
    // @ts-expect-error Only a query of one row resolves to null.
    from(post).nullable()
    // @ts-expect-error The value of a missing row is never null.
    from(post).get("title").nullable()
  })
})

describe("required", () => {
  test("rejects without a row", () => {
    const optional = from(post).select("id").take().optional().required()
    expectTypeOf<Executed<typeof optional>>().toEqualTypeOf<{ id: string }>()

    const nullable = db.post.take().nullable().get("title").required()
    expectTypeOf<Awaited<typeof nullable>>().toEqualTypeOf<string>()
  })

  test("rejects a query of many rows", () => {
    // @ts-expect-error Only a query of one row is required.
    from(post).required()
  })
})

describe("use", () => {
  test("passes the query to the callback and returns the query of the callback", () => {
    const unbound = from(post).use(posts => {
      expectTypeOf(posts).toEqualTypeOf<SelectQuery<InitialQueryState<typeof post>>>()
      return posts.select("id")
    })
    expectTypeOf<Executed<typeof unbound>>().toEqualTypeOf<{ id: string }[]>()
    expectTypeOf<Awaited<typeof unbound>>().toEqualTypeOf<typeof unbound>()

    const bound = db.post.use(posts => posts.select("id")).take()
    expectTypeOf<Awaited<typeof bound>>().toEqualTypeOf<{ id: string }>()
  })

  test("continues the chain after branches that leave the same state", () => {
    const pick = (published: boolean) =>
      db.post.use(posts => (published ? posts.where({ title: "First" }) : posts)).select("id")

    expectTypeOf<Awaited<ReturnType<typeof pick>>>().toEqualTypeOf<{ id: string }[]>()
  })

  test("selects a field after a branch that may have selected it", () => {
    const pick = (withTitle: boolean) =>
      db.post.use(posts => (withTitle ? posts.select("title") : posts)).select("title")

    expectTypeOf<Awaited<ReturnType<typeof pick>>>().toEqualTypeOf<{ title: string }[]>()
  })

  test("ends the chain of overloaded methods after branches that leave different states", () => {
    const pick = (single: boolean) =>
      db.post.use(posts => (single ? posts.select("id").take() : posts.select("title")))

    const query = pick(true).where({ title: "First" })
    expectTypeOf<Awaited<typeof query>>().toEqualTypeOf<{ id: string } | { title: string }[]>()
    // @ts-expect-error TypeScript cannot call the overloads of `select` on a union of query states.
    query.select("hint")
  })

  test("passes a query of either kind, which may execute", () => {
    const posts: SelectQuery<InitialQueryState<typeof post>, SelectQueryKind> = db.post

    const titles = posts.use(either => either.pluck("title"))
    expectTypeOf<Executed<typeof titles>>().toEqualTypeOf<string[]>()
    posts.use(either => {
      // @ts-expect-error A query of either kind may execute when awaited.
      void (async () => await either)()
      return either
    })
  })

  test("rejects a result other than a query of the same kind", () => {
    // @ts-expect-error The callback returns a query, not a Promise.
    db.post.use(async posts => posts.select("id"))
    // @ts-expect-error The callback returns a query.
    from(post).use(() => 1)
    // @ts-expect-error A query of a Db cannot become unbound.
    db.post.use(() => from(post))
    // @ts-expect-error An unbound query cannot become bound to a Db.
    from(post).use(() => db.post)
  })
})
