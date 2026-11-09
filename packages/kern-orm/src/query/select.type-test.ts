import { describe, expectTypeOf, test } from "bun:test"

import { createRecordingDriver } from "../../testing/recording-driver"
import { createDatabase } from "../execution/database"
import type { DbOf } from "../execution/db"
import { avg, count, every, max, min, some, stringAgg, sum } from "../expression/aggregates"
import type { AnyExpression, Expression, TypedExpression } from "../expression/expression"
import type { Operand } from "../expression/operators/comparison"
import { and } from "../expression/predicates"
import { param, sql } from "../expression/sql"
import { defineSchema } from "../schema/schema"
import type { Table } from "../table/table"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { ColumnRefs } from "./column-refs"
import { defineHelper } from "./helper"
import type { SelectQueryKind } from "./kind"
import { literal } from "./literal"
import { desc, orderBy } from "./order"
import type { QueryResult } from "./rows"
import type { AnySelectQuery, BoundSelectQuery, ResultOf, SelectQuery } from "./select"
import { from } from "./select"
import type { Selection } from "./selection"
import type {
  EmptyRecord,
  FoundKey,
  InitialQueryState,
  QueryStateOf,
  SingletonQueryState,
} from "./state"
import type { InsertValues, UpsertValues } from "./values"

declare const flag: boolean

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

  // Orchid ORM typed a key that a relation value and a column share as their intersection: https://github.com/romeerez/orchid-orm/issues/790
  test("keeps filters and get on the column under the key of a field of a nested query", () => {
    const query = from(post).select(() => ({
      title: from(post).count(),
    }))
    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ title: number }>()

    query.where({ title: "First" })
    // @ts-expect-error A filter takes the values of the column under the key of a selected field.
    query.where({ title: 1 })
    const title = query.get("title")
    expectTypeOf<Executed<typeof title>>().toEqualTypeOf<string>()
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

describe("find and findBy", () => {
  const user = defineTable("user", {
    id: t.uuid.primaryKey(),
    email: t.text.nullable().unique(),
    name: t.text,
  })
  const membership = defineTable(
    "membership",
    {
      userId: t.uuid,
      groupId: t.uuid,
      role: t.text,
    },
    { primaryKey: ["userId", "groupId"] },
  )
  const session = defineTable("session", {
    token: t.text.unique(),
    userId: t.uuid,
  })
  const widenedUser: Table<"user", typeof user.columns> = user
  const usersDb = createDatabase({ driver: createRecordingDriver().driver }).bind(
    defineSchema({ user, membership }),
  )

  test("find returns one row by the values of the primary key, as where followed by take, and keeps the columns of the key for upsert", () => {
    const query = from(user).select("name").find("user-id")
    const taken = from(user).select("name").where({ id: "user-id" }).take()
    expectTypeOf<Omit<(typeof query)["types"], keyof FoundKey<string>>>().toEqualTypeOf<
      (typeof taken)["types"]
    >()
    expectTypeOf<(typeof query)["types"]["foundKey"]>().toEqualTypeOf<"id">()
    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<{ name: string }>()

    const role = usersDb.membership.find("user-id", "group-id").get("role")
    expectTypeOf<Awaited<typeof role>>().toEqualTypeOf<string>()
    const email = usersDb.user.pluck("email").take().optional().find("user-id")
    expectTypeOf<Awaited<typeof email>>().toEqualTypeOf<string | null | undefined>()
  })

  test("find takes a value of each column of the primary key in their order, such as an expression", () => {
    const query = from(membership).select(columns => ({
      user: from(user).find(columns.userId).select("name"),
    }))
    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<{ user: { name: string } }[]>()

    // @ts-expect-error A value of each column of the primary key.
    from(membership).find("user-id")
    // @ts-expect-error A value of each column of the primary key.
    from(membership).find("user-id", "group-id", "member")
    // @ts-expect-error A value of the type of its column.
    from(user).find(1)
    // @ts-expect-error An expression of the type of its column.
    from(user).find(sql(t.integer)`1`)
    // @ts-expect-error A value of a key is never null.
    from(user).find(null)
    // @ts-expect-error A value of a key is never undefined.
    from(user).find(undefined)
  })

  test("find rejects a table whose type tells no primary key", () => {
    // @ts-expect-error A table without a primary key.
    from(session).find("token")
    // @ts-expect-error A table whose type tells no keys.
    from(widenedUser).find("user-id")
  })

  test("findBy returns one row by the values of the columns of one key, primary or unique, in any order, and keeps the columns of the key for upsert", () => {
    const query = from(user).select("name").findBy({ email: "ann@example.com" })
    const taken = from(user).select("name").where({ email: "ann@example.com" }).take()
    expectTypeOf<Omit<(typeof query)["types"], keyof FoundKey<string>>>().toEqualTypeOf<
      (typeof taken)["types"]
    >()
    expectTypeOf<(typeof query)["types"]["foundKey"]>().toEqualTypeOf<"email">()
    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<{ name: string }>()

    const role = usersDb.membership.findBy({ groupId: "group-id", userId: "user-id" }).get("role")
    expectTypeOf<Awaited<typeof role>>().toEqualTypeOf<string>()
    from(user).findBy({ id: "user-id" })
    from(session).findBy({ token: "token" })
    from(membership).select(columns => ({
      user: from(user).findBy({ id: columns.userId }),
    }))
  })

  test("find and findBy of different keys give queries of different states, whose union rejects the methods that change the state", () => {
    const query =
      Math.random() > 0.5
        ? from(user).find("user-id")
        : from(user).findBy({ email: "ann@example.com" })
    expectTypeOf(query.where({ name: "Ann" })).toEqualTypeOf(query)
    // @ts-expect-error No single state describes both queries.
    query.select("name")
    // @ts-expect-error No single state describes both queries.
    query.get("name")
  })

  test("findBy rejects columns that are not exactly one key", () => {
    // @ts-expect-error The columns of two keys.
    from(user).findBy({ id: "user-id", email: "ann@example.com" })
    // @ts-expect-error A part of a key.
    from(membership).findBy({ userId: "user-id" })
    // @ts-expect-error A column outside the keys.
    from(user).findBy({ name: "Ann" })
    // @ts-expect-error A column outside the table.
    from(user).findBy({ id: "user-id", nmae: "Ann" })
    // @ts-expect-error No columns.
    from(user).findBy({})
    // @ts-expect-error A table whose type tells no keys.
    from(widenedUser).findBy({ id: "user-id" })
  })

  test("findBy rejects null and undefined", () => {
    // @ts-expect-error A value of a key is never null, even of a nullable column.
    from(user).findBy({ email: null })
    // @ts-expect-error A value of a key is never undefined.
    from(user).findBy({ id: undefined })
  })

  test("find and findBy reject null and undefined that eq of a column takes", () => {
    const tagName = t.text.withOperators({
      eq: (self, value: string | null | undefined) =>
        sql(t.boolean)`${self} IS NOT DISTINCT FROM ${value ?? null}`,
    })
    const tag = defineTable("tag", {
      name: tagName.primaryKey(),
    })
    from(tag).where({ name: undefined })
    from(tag).find("tag")

    // @ts-expect-error A value of a key is never null.
    from(tag).find(null)
    // @ts-expect-error A value of a key is never undefined.
    from(tag).findBy({ name: undefined })
  })
})

describe("queries of a singleton table", () => {
  const license = defineTable(
    "license",
    {
      id: t.uuid.primaryKey(),
      token: t.text,
    },
    { singleton: true },
  )
  const licenseSchema = defineSchema({ license })
  const licenses = createDatabase({ driver: createRecordingDriver().driver }).bind(licenseSchema)

  test("start as a query of its one row, which resolves to undefined without it", () => {
    expectTypeOf(licenses.license).toEqualTypeOf<
      BoundSelectQuery<SingletonQueryState<typeof license>>
    >()
    expectTypeOf(licenseSchema.license).toEqualTypeOf<
      SelectQuery<SingletonQueryState<typeof license>>
    >()
    expectTypeOf(from(license)).toEqualTypeOf<SelectQuery<SingletonQueryState<typeof license>>>()
    expectTypeOf(licenses.license).resolves.toEqualTypeOf<EmptyRecord | undefined>()
    expectTypeOf(licenses.license.get("token")).resolves.toEqualTypeOf<string | undefined>()
    expectTypeOf(licenses.license.select("token")).resolves.toEqualTypeOf<
      { token: string } | undefined
    >()
    const shared: DbOf<typeof licenseSchema> = licenses
    void shared
  })

  test("take the methods of a query of one row, and take keeps its row", () => {
    expectTypeOf(licenses.license.take()).resolves.toEqualTypeOf<EmptyRecord | undefined>()
    expectTypeOf(licenses.license.required().get("token")).resolves.toEqualTypeOf<string>()
    expectTypeOf(licenses.license.nullable().select("token")).resolves.toEqualTypeOf<{
      token: string
    } | null>()
    expectTypeOf(licenses.license.find("license-id").get("token")).resolves.toEqualTypeOf<
      string | undefined
    >()
    expectTypeOf(licenses.license.count()).resolves.toEqualTypeOf<number>()
    expectTypeOf(licenses.license.exists()).resolves.toEqualTypeOf<boolean>()
  })

  test("apply a helper of the table in the rows mode of the query", () => {
    const withToken = defineHelper(licenseSchema.license, query => query.select("token"))

    expectTypeOf(licenses.license.use(withToken)).resolves.toEqualTypeOf<
      { token: string } | undefined
    >()
  })

  test("reject the methods of a query of many rows", () => {
    // @ts-expect-error A query of one row.
    licenses.license.all()
    // @ts-expect-error A query of one row.
    licenses.license.limit(1)
    // @ts-expect-error A query of one row.
    licenses.license.offset(1)
    // @ts-expect-error A query of one row.
    licenses.license.distinct()
  })

  test("start as a query of either where the type of the table does not tell whether it is a singleton", () => {
    const widened: Table<"license", typeof license.columns> = license
    const query = from(widened)

    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<EmptyRecord[] | EmptyRecord | undefined>()
  })

  test("start a query of a table of a generic type by the constraint of its type", () => {
    const tokenOf = <T extends typeof license>(table: T, values: UpsertValues<T, never>) => {
      void from(table).upsert(values)
      return from(table).required().get("token")
    }
    const titlesOf = <T extends typeof post>(table: T, values: InsertValues<T>) => {
      void from(table).insert(values)
      return from(table).limit(10).pluck("title")
    }

    expectTypeOf<Executed<ReturnType<typeof tokenOf<typeof license>>>>().toEqualTypeOf<string>()
    expectTypeOf<Executed<ReturnType<typeof titlesOf<typeof post>>>>().toEqualTypeOf<string[]>()
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

  test("resolves to undefined without a row after nullable", () => {
    const title = from(post).take().nullable().get("title")
    expectTypeOf<Executed<typeof title>>().toEqualTypeOf<string | undefined>()
    const hint = from(post).take().nullable().get("hint")
    expectTypeOf<Executed<typeof hint>>().toEqualTypeOf<string | null | undefined>()
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

  test("resolves to undefined without a row after nullable", () => {
    const title = from(post).take().nullable().pluck("title")
    expectTypeOf<Executed<typeof title>>().toEqualTypeOf<string | undefined>()
    const hint = from(post).take().nullable().pluck("hint")
    expectTypeOf<Executed<typeof hint>>().toEqualTypeOf<string | null | undefined>()
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

describe("count", () => {
  test("returns the number of rows of a query of any rows and value", () => {
    const count = from(post).select("id").where({ title: "First" }).count()
    expectTypeOf<Executed<typeof count>>().toEqualTypeOf<number>()

    const nullable = from(post).take().nullable().count()
    expectTypeOf<Executed<typeof nullable>>().toEqualTypeOf<number>()

    const optional = from(post).get("hint").optional().count()
    expectTypeOf<Executed<typeof optional>>().toEqualTypeOf<number>()

    const page = db.post.limit(20).offset(40).pluck("title").count()
    expectTypeOf<Awaited<typeof page>>().toEqualTypeOf<number>()
  })

  test("keeps the number after a filter", () => {
    const count = from(post).count().where({ title: "First" }).take()
    expectTypeOf<Executed<typeof count>>().toEqualTypeOf<number>()
  })

  test("rejects a change of the selection and pagination", () => {
    const count = from(post).count()

    // @ts-expect-error A query of the number of rows cannot select fields.
    count.select("id")
    // @ts-expect-error A query of the number of rows has no pagination.
    count.limit(10)
    // @ts-expect-error A query of the number of rows has no pagination.
    count.offset(10)
  })
})

describe("aggregates", () => {
  const stat = defineTable("stat", {
    page: t.text,
    views: t.integer,
    bytes: t.bigint,
    exact: t.numeric.nullable(),
    truncated: t.numeric.transform({
      decode: text => BigInt(Math.trunc(Number(text))),
      encode: (value: bigint | number) => value,
    }),
    smallBigint: t.integer.transform({
      decode: value => BigInt(value),
      encode: (value: bigint) => Number(value),
    }),
    bounced: t.boolean,
  })

  test("return the values of the column or the expression, or null without values", () => {
    const query = from(stat).where({ page: "/" })

    const min = query.min("page")
    expectTypeOf<Executed<typeof min>>().toEqualTypeOf<string | null>()
    const max = query.max(columns => sql(t.integer)`${columns.views} * 2`)
    expectTypeOf<Executed<typeof max>>().toEqualTypeOf<number | null>()
    const sum = query.sum("exact")
    expectTypeOf<Executed<typeof sum>>().toEqualTypeOf<string | null>()
    const bytes = query.sum("bytes")
    expectTypeOf<Executed<typeof bytes>>().toEqualTypeOf<bigint | null>()
    const every = query.every("bounced")
    expectTypeOf<Executed<typeof every>>().toEqualTypeOf<boolean | null>()
    const some = query.some(columns => columns.views.gt(10))
    expectTypeOf<Executed<typeof some>>().toEqualTypeOf<boolean | null>()
    const pages = query.stringAgg("page", ", ")
    expectTypeOf<Executed<typeof pages>>().toEqualTypeOf<string | null>()
  })

  test("return the average as the values of the type of the column or the expression", () => {
    const views = from(stat).avg("views")
    expectTypeOf<Executed<typeof views>>().toEqualTypeOf<number | null>()
    const bytes = from(stat).avg(columns => sql(t.doublePrecision)`${columns.bytes}`)
    expectTypeOf<Executed<typeof bytes>>().toEqualTypeOf<number | null>()
    const exact = from(stat).avg(columns => columns.exact)
    expectTypeOf<Executed<typeof exact>>().toEqualTypeOf<string | null>()
    const truncated = from(stat).avg("truncated")
    expectTypeOf<Executed<typeof truncated>>().toEqualTypeOf<bigint | null>()
    const truncatedExpression = from(stat).avg(columns => columns.truncated)
    expectTypeOf<Executed<typeof truncatedExpression>>().toEqualTypeOf<bigint | null>()
    const smallBigint = from(stat).avg("smallBigint").coalesce(0n)
    expectTypeOf<Executed<typeof smallBigint>>().toEqualTypeOf<bigint>()
    // @ts-expect-error A fallback of an average is a value of the type of the values.
    from(stat).avg("smallBigint").coalesce(0)
  })

  test("count the values other than NULL", () => {
    const count = from(stat).count("exact")
    expectTypeOf<Executed<typeof count>>().toEqualTypeOf<number>()
    const distinct = from(stat).countDistinct(columns => columns.page)
    expectTypeOf<Executed<typeof distinct>>().toEqualTypeOf<number>()
  })

  test("accept a column or an expression with a type, and reject a change of the selection or the value, another aggregate, and pagination", () => {
    // @ts-expect-error A value is a column of the table.
    from(stat).max("missing")
    // @ts-expect-error An expression has a type to decode its values.
    from(stat).max(columns => sql<number>`${columns.views}`)
    // @ts-expect-error stringAgg takes a delimiter.
    from(stat).stringAgg("page")

    const max = db.post.max("title")
    expectTypeOf<Awaited<typeof max>>().toEqualTypeOf<string | null>()
    // @ts-expect-error A query of an aggregate cannot select fields.
    max.select("id")
    // @ts-expect-error A query of an aggregate cannot replace it with a value of the rows.
    max.get("title")
    // @ts-expect-error A query of an aggregate cannot replace it with a value of the rows.
    max.pluck(columns => columns.title)
    // @ts-expect-error A query of an aggregate cannot be aggregated again, also after the methods that keep its value.
    max.where({ title: "First" }).coalesce("Untitled").count()
    // @ts-expect-error A query of an aggregate cannot be aggregated again.
    max.sum("title")
    // @ts-expect-error A query of an aggregate has no pagination.
    max.limit(10)
  })

  test("apply to a state that is not of an aggregate query, and reject one that may be", () => {
    function replaceValue<S extends QueryStateOf<typeof post>, Kind extends SelectQueryKind>(
      query: SelectQuery<S, Kind>,
    ) {
      // @ts-expect-error The query may be a query of an aggregate.
      void query.get("title")
      // @ts-expect-error The query may be a query of an aggregate.
      void query.pluck("title")
      // @ts-expect-error The query may be a query of an aggregate.
      void query.count()
    }
    void replaceValue

    function count<
      S extends QueryStateOf<typeof post> & { readonly aggregate: false },
      Kind extends SelectQueryKind,
    >(query: SelectQuery<S, Kind>) {
      return query.count()
    }
    const titleCount = count(db.post.pluck("title"))
    expectTypeOf<Awaited<typeof titleCount>>().toEqualTypeOf<number>()
  })
})

describe("exists", () => {
  test("returns whether a query of any rows and value has a row", () => {
    const exists = from(post).select("id").where({ title: "First" }).exists()
    expectTypeOf<Executed<typeof exists>>().toEqualTypeOf<boolean>()

    const optional = from(post).get("hint").optional().exists()
    expectTypeOf<Executed<typeof optional>>().toEqualTypeOf<boolean>()

    const page = db.post.limit(20).offset(40).pluck("title").exists()
    expectTypeOf<Awaited<typeof page>>().toEqualTypeOf<boolean>()

    const filtered = from(post).exists().where({ title: "First" }).coalesce(false)
    expectTypeOf<Executed<typeof filtered>>().toEqualTypeOf<boolean>()
  })

  test("rejects a change of the selection or the value, an aggregate, exists, and pagination, and applies to no aggregate query", () => {
    const exists = from(post).exists()

    // @ts-expect-error A query of exists cannot select fields.
    exists.select("id")
    // @ts-expect-error A query of exists cannot replace its value with a value of the rows.
    exists.get("title")
    // @ts-expect-error A query of exists cannot be aggregated.
    exists.count()
    // @ts-expect-error A query of exists cannot be checked again.
    exists.exists()
    // @ts-expect-error A query of exists has no pagination.
    exists.limit(1)
    // @ts-expect-error An aggregate query does not accept exists.
    from(post).count().exists()
  })
})

describe("coalesce", () => {
  const stat = defineTable("stat", {
    page: t.text,
    bytes: t.bigint,
    exact: t.numeric.nullable(),
  })

  test("takes a value that the type of the value accepts and removes null", () => {
    const sum = from(stat).sum("exact").coalesce(0)
    expectTypeOf<Executed<typeof sum>>().toEqualTypeOf<string>()
    const bytes = from(stat).sum("bytes").coalesce(0)
    expectTypeOf<Executed<typeof bytes>>().toEqualTypeOf<bigint>()
    const exacts = from(stat).pluck("exact").coalesce(1n)
    expectTypeOf<Executed<typeof exacts>>().toEqualTypeOf<string[]>()
    const exactAverage = from(stat).avg("exact").coalesce(1n)
    expectTypeOf<Executed<typeof exactAverage>>().toEqualTypeOf<string>()
    const count = from(stat).count().coalesce(0)
    expectTypeOf<Executed<typeof count>>().toEqualTypeOf<number>()
  })

  test("keeps a missing row and the null of an expression that can be NULL", () => {
    const optional = from(stat).get("exact").optional().coalesce("0")
    expectTypeOf<Executed<typeof optional>>().toEqualTypeOf<string | undefined>()
    const nullable = from(stat)
      .max("exact")
      .coalesce(sql(t.numeric.nullable())`NULL`)
    expectTypeOf<Executed<typeof nullable>>().toEqualTypeOf<string | null>()
    const expression = from(stat)
      .max("exact")
      .coalesce(sql(t.numeric)`0`)
    expectTypeOf<Executed<typeof expression>>().toEqualTypeOf<string>()
  })

  test("takes a query of one value, keeping null when its value can be NULL", () => {
    const named = from(stat).max("page").coalesce(from(stat).min("page").coalesce("none"))
    expectTypeOf<Executed<typeof named>>().toEqualTypeOf<string>()
    const nullable = from(stat).max("page").coalesce(from(stat).min("page"))
    expectTypeOf<Executed<typeof nullable>>().toEqualTypeOf<string | null>()
    const missing = from(stat).max("page").coalesce(from(stat).get("page"))
    expectTypeOf<Executed<typeof missing>>().toEqualTypeOf<string | null>()

    // @ts-expect-error The value of the query is of another type.
    from(stat).max("page").coalesce(from(stat).count())
    // @ts-expect-error A query of an array of values has no value to take.
    from(stat).max("page").coalesce(from(stat).pluck("page"))
  })

  test("removes only null, keeping undefined that a decoder returns and JSON values", () => {
    const item = defineTable("item", {
      label: t.text.transform({ decode: text => (text === "" ? undefined : text) }).nullable(),
      data: t.jsonb.nullable(),
    })

    const label = from(item).get("label").coalesce("none")
    expectTypeOf<Executed<typeof label>>().toEqualTypeOf<string | undefined>()
    // A JSON `null` value stays `null`.
    const data = from(item).get("data").coalesce({})
    expectTypeOf<Executed<typeof data>>().toEqualTypeOf<unknown>()
  })

  test("rejects a query of records, null, and values of another type", () => {
    // @ts-expect-error A query of records has no value to replace.
    from(stat).coalesce("0")
    // @ts-expect-error A fallback is not null.
    from(stat).max("exact").coalesce(null)
    // @ts-expect-error A fallback is a value of the type of the value.
    from(stat).max("page").coalesce(1)
  })
})

describe("expr", () => {
  const stat = defineTable("stat", {
    page: t.text,
    hits: t.integer,
    opened: t.timestamptz,
    tag: t.uuid.nullable(),
    near: t.integer.withOperators({
      near: (self, value: number) => sql(t.boolean)`${self} - ${value} < 10`,
    }),
    size: t.jsonb,
  })

  test("gives an expression of the value with the operators of its type", () => {
    const text = from(stat).get("page").expr()
    expectTypeOf(text.ilike("x%")).toEqualTypeOf<Expression<boolean | null>>()
    const count = from(stat).count().expr()
    expectTypeOf(count.gt(3)).toEqualTypeOf<Expression<boolean>>()
    const custom = from(stat).max("near").expr()
    expectTypeOf(custom.near(1)).toEqualTypeOf<Expression<boolean>>()
    const callback = from(stat)
      .take()
      .pluck(columns => columns.page)
      .expr()
    expectTypeOf(callback.like("x%")).toEqualTypeOf<Expression<boolean | null>>()
    const summed = from(stat)
      .sum(columns => columns.hits)
      .expr()
    expectTypeOf(summed.lte(1)).toEqualTypeOf<Expression<boolean | null>>()
    const existing = from(stat).exists().expr()
    expectTypeOf(existing.eq(true)).toEqualTypeOf<Expression<boolean>>()
    expectTypeOf(from(stat).count().expr().isNull()).toEqualTypeOf<Expression<boolean>>()
  })

  test("types the value by the query in an expression, keeping the values that its type accepts", () => {
    expectTypeOf(from(stat).get("hits").expr()).toExtend<AnyExpression<number | null, number>>()
    expectTypeOf(from(stat).get("opened").expr().gt(new Date())).toEqualTypeOf<
      Expression<boolean | null>
    >()
    expectTypeOf(from(stat).count().expr()).toExtend<AnyExpression<number, number>>()
    expectTypeOf(from(stat).max("hits").expr()).toExtend<AnyExpression<number | null, number>>()
    expectTypeOf(from(stat).max("hits").coalesce(0).expr()).toExtend<
      AnyExpression<number, number>
    >()
    expectTypeOf(from(stat).exists().expr()).toExtend<AnyExpression<boolean, boolean>>()
  })

  test("gives an expression with a type, which selects and takes the place of an operand", () => {
    const selected = from(stat).select(() => ({
      total: from(stat).count().expr(),
      missing: from(stat).get("tag").expr(),
      several: from(stat).count().expr().gt(1),
    }))
    expectTypeOf<Executed<typeof selected>>().toEqualTypeOf<
      { total: number; missing: string | null; several: boolean }[]
    >()

    from(stat).where(columns => columns.hits.lt(from(stat).count().expr()))
    from(stat).where(() => from(stat).get("hits").expr().gt(1))
    from(stat).orderBy(() => desc(from(stat).count().expr()))
  })

  test("applies to a union of queries of one value", () => {
    const flag = Math.random() > 0.5
    const value = (flag ? from(stat).max("hits") : from(stat).count()).expr()
    expectTypeOf(value.gt(1)).toEqualTypeOf<Expression<boolean | null>>()
  })

  test("rejects a query of records, of an array of values, and an operand of another type", () => {
    // @ts-expect-error A query of records has no value.
    from(stat).take().expr()
    // @ts-expect-error A query of an array of values has no value.
    from(stat).pluck("hits").expr()
    // @ts-expect-error The operand is of another type.
    from(stat).count().expr().gt("3")
    // @ts-expect-error A type of JSON values has no operators of ordering.
    from(stat).get("size").expr().gt(1)
    // @ts-expect-error A count has no operators of text.
    from(stat).count().expr().ilike("x%")
  })
})

describe("groupBy", () => {
  test("allows conditional grouping to assign back to the original variable", () => {
    const base = from(post).select("title")
    expectTypeOf(base.groupBy("title")).toExtend<typeof base>()
    expectTypeOf(base.groupBy(columns => [columns.title, columns.hint])).toExtend<typeof base>()

    let query = base
    query = query.groupBy("title")
    expectTypeOf(query.take()).toEqualTypeOf(base.take())
  })

  test("rejects a union of distinct query states, as other state-changing methods do", () => {
    const query = flag ? from(post).take() : from(post).limit(20)
    // @ts-expect-error No single state describes both queries.
    query.groupBy("title")
  })

  test("takes columns, and an expression or a query of one value of a callback, or an array of them", () => {
    from(post).groupBy("title", "hint")
    from(post).groupBy(columns => columns.title)
    from(post).groupBy(columns => [columns.title, sql`lower(${columns.hint})`])
    from(post).groupBy(() => from(post).max("title"))

    // @ts-expect-error A key is a column of the table.
    from(post).groupBy("unknown")
    // @ts-expect-error An object of directions gives no key.
    from(post).groupBy({ title: "asc" })
    // @ts-expect-error A plain value is no key.
    from(post).groupBy(() => "title")
    // @ts-expect-error A key has no direction.
    from(post).groupBy(columns => desc(columns.title))
    // @ts-expect-error A query of many rows has no value.
    from(post).groupBy(() => from(post).pluck("title"))
    // @ts-expect-error A query of records has no value.
    from(post).groupBy(() => from(post).select("title").take())
  })

  test("gives the callback the selected fields of a query of records and the value of a query of values, as orderBy does", () => {
    from(post)
      .select(columns => ({
        bucket: sql(t.integer)`length(${columns.title})`,
        total: count(),
      }))
      .groupBy((_columns, selected) => {
        expectTypeOf(selected.bucket).toEqualTypeOf<AnyExpression<number>>()
        return selected.bucket
      })
    from(post)
      .pluck("title")
      .groupBy((_columns, value) => {
        expectTypeOf(value).toEqualTypeOf<AnyExpression<string>>()
        return value
      })
    from(post)
      .select("title")
      // @ts-expect-error The field is not selected.
      .groupBy((_columns, selected) => selected.hint)
  })

  test("does not check the fields beside the keys, which PostgreSQL rejects", () => {
    const query = from(post).groupBy("title").select("hint", "id")

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ hint: string | null; id: string }>()
  })

  test("removes null introduced by aggregates of nonempty groups", () => {
    const query = from(post)
      .groupBy("title")
      .select(columns => ({
        title: columns.title,
        total: count(),
        length: sum(columns.title.length()),
      }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{
      title: string
      total: number
      length: number
    }>()
  })

  test("narrows every unfiltered aggregate before or after grouping, preserving nullable arguments and filters", () => {
    const selected = from(post).select(columns => ({
      minimum: min(columns.title.length()),
      maximum: max(columns.title),
      average: avg(columns.title.length()),
      all: every(columns.title.eq("x")),
      any: some(columns.title.eq("x")),
      joined: stringAgg(columns.title, ",", { orderBy: columns.title }),
      nullable: max(columns.hint),
      filtered: sum(columns.title.length(), { filter: columns.title.eq("x") }),
      maybeFiltered: sum(columns.title.length(), {} as { filter?: Expression<boolean> }),
      emptyOptions: sum(columns.title.length(), {}),
      undefinedFilter: sum(columns.title.length(), { filter: undefined }),
      // Functions of aggregates keep their standalone nullability.
      positive: sum(columns.title.length()).gt(0),
    }))
    const grouped = selected.groupBy("title")
    expectTypeOf<ResultOf<typeof grouped>>().toEqualTypeOf<{
      minimum: number
      maximum: string
      average: number
      all: boolean
      any: boolean
      joined: string
      nullable: string | null
      filtered: number | null
      maybeFiltered: number | null
      emptyOptions: number
      undefinedFilter: number
      positive: boolean | null
    }>()
    const repeated = grouped.groupBy("hint")
    expectTypeOf<ResultOf<typeof repeated>>().toEqualTypeOf<ResultOf<typeof grouped>>()
    const cleared = grouped.clearSelect().select(columns => ({
      total: sum(columns.title.length()),
    }))
    expectTypeOf<ResultOf<typeof cleared>>().toEqualTypeOf<{ total: number }>()
  })

  test("narrows get and pluck in either order without changing missing-row behavior", () => {
    const grouped = from(post).groupBy("title")
    const after = grouped.pluck(columns => sum(columns.title.length()))
    const before = from(post)
      .pluck(columns => sum(columns.title.length()))
      .groupBy("title")
    const one = grouped.get(columns => max(columns.title)).optional()
    const oneBefore = from(post)
      .get(columns => max(columns.title))
      .optional()
      .groupBy("title")
    expectTypeOf<Executed<typeof after>>().toEqualTypeOf<number[]>()
    expectTypeOf<Executed<typeof before>>().toEqualTypeOf<number[]>()
    expectTypeOf<Executed<typeof one>>().toEqualTypeOf<string | undefined>()
    expectTypeOf<Executed<typeof oneBefore>>().toEqualTypeOf<string | undefined>()
    const fallback = from(post)
      .pluck(columns => sum(columns.hint.length()))
      .coalesce(0)
      .groupBy("title")
    expectTypeOf<Executed<typeof fallback>>().toEqualTypeOf<number[]>()
    const nullableFallback = from(post)
      .pluck(columns => sum(columns.title.length()))
      .coalesce(sql(t.integer.nullable())`NULL`)
      .groupBy("title")
    expectTypeOf<Executed<typeof nullableFallback>>().toEqualTypeOf<(number | null)[]>()
  })

  test("keeps null from a replacement, a union, an optional field, or a literal", () => {
    const nullable: { total?: Expression<number | null> } = {}
    const query = from(post)
      .select(columns => ({
        total: sum(columns.title.length()),
        literal: literal(null),
        union: flag ? sum(columns.title.length()) : sql(t.integer.nullable())`NULL`,
      }))
      .select(() => nullable)
      .groupBy("title")
    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{
      total: number | null | undefined
      literal: null
      union: number | null
    }>()
    const optional: { total?: ReturnType<typeof sum<ColumnRefs<typeof post>["title"]>> } = {}
    const optionalQuery = from(post)
      .select(() => optional)
      .groupBy("title")
    expectTypeOf<ResultOf<typeof optionalQuery>>().toEqualTypeOf<{ total?: string | null }>()
    const selectTotal = (columns: ColumnRefs<typeof post>) => ({
      total: sum(columns.title.length()),
    })
    const optionalAggregate: Partial<ReturnType<typeof selectTotal>> = {}
    const optionalGrouped = from(post)
      .select(() => optionalAggregate)
      .groupBy("title")
    expectTypeOf<ResultOf<typeof optionalGrouped>>().toEqualTypeOf<{ total?: number }>()
    const replaced = from(post)
      .select(columns => ({
        total: sum(columns.title.length()),
      }))
      .select(() => ({
        total: sql(t.integer.nullable())`NULL`,
      }))
      .groupBy("title")
    expectTypeOf<ResultOf<typeof replaced>>().toEqualTypeOf<{ total: number | null }>()
  })

  test("keeps selected aggregate references nullable when reused outside their grouped query", () => {
    const base = from(post)
    base
      .select(columns => ({
        total: sum(columns.title.length()),
      }))
      .groupBy("title")
      .having((_columns, selected) => {
        const ungrouped = base.select(() => ({
          total: selected.total,
        }))
        const grouped = ungrouped.groupBy("title")
        expectTypeOf<ResultOf<typeof ungrouped>>().toEqualTypeOf<{ total: number | null }>()
        expectTypeOf<ResultOf<typeof grouped>>().toEqualTypeOf<{ total: number }>()
        return selected.total.gt(0)
      })
    base
      .groupBy("title")
      .pluck(columns => sum(columns.title.length()))
      .having((_columns, value) => {
        const ungrouped = base.pluck(() => value)
        expectTypeOf<Executed<typeof ungrouped>>().toEqualTypeOf<(number | null)[]>()
        return value.gt(0)
      })
  })

  test("applies the methods that choose rows and read values, and an aggregate method gives one value of the groups", () => {
    const groups = from(post).groupBy("title")
    const number = groups.count()
    const largest = groups.max(columns => columns.title.length())
    const taken = groups.select("title").take()
    const values = groups.pluck("title")
    const exists = groups.exists()

    expectTypeOf<Executed<typeof number>>().toEqualTypeOf<number>()
    expectTypeOf<Executed<typeof largest>>().toEqualTypeOf<number | null>()
    expectTypeOf<Executed<typeof taken>>().toEqualTypeOf<{ title: string }>()
    expectTypeOf<Executed<typeof values>>().toEqualTypeOf<string[]>()
    expectTypeOf<Executed<typeof exists>>().toEqualTypeOf<boolean>()
  })

  test("rejects a query made by an aggregate method, exists, or map", () => {
    const aggregate = from(post).max("title")
    const exists = from(post).exists()
    const mapped = from(post)
      .select("title")
      .map(row => row.title)

    // @ts-expect-error An aggregate query has one row of its aggregate.
    aggregate.groupBy("title")
    // @ts-expect-error An aggregate query has one row of its aggregate.
    aggregate.groupBy(columns => columns.title)
    // @ts-expect-error A query of exists has one row of whether a row exists.
    exists.groupBy("title")
    // @ts-expect-error A query that map converts reads its fields in code.
    mapped.groupBy("title")
  })
})

describe("having", () => {
  const groups = from(post).groupBy("title").select("title")

  test("keeps the state of a query whose row no relation guarantees", () => {
    expectTypeOf(groups.having(() => count().gt(1))).toEqualTypeOf<typeof groups>()
    expectTypeOf(groups.having({ title: "Hello" })).toEqualTypeOf<typeof groups>()
  })

  test("takes what where takes, and types a literal by its column", () => {
    groups.having(columns => sum(columns.title.length()).gt(0))
    groups.having(columns => columns.title.eq("Hello"))
    groups.having(() => count().gt(1))
    groups.having(from(post).exists())

    // @ts-expect-error A count takes a number.
    groups.having(() => count().gt("1"))
    // @ts-expect-error A column of the table.
    groups.having({ unknown: "Hello" })
    // @ts-expect-error A plain Boolean value is no condition.
    groups.having(true)
  })

  test("gives the callback the selected fields with the operators and the values of their types", () => {
    const withTotal = defineHelper(post, posts =>
      posts.select(() => ({
        total: count(),
      })),
    )
    from(post)
      .select(columns => ({
        title: columns.title,
        stamp: sql(t.timestamptz)`now()`,
        others: from(post).count(),
      }))
      .groupBy("title")
      .use(withTotal)
      .having((_columns, selected) =>
        and(
          selected.title.ilike("a%"),
          selected.stamp.gt(new Date()),
          selected.others.lt(10),
          selected.total.gt(1),
        ),
      )
    from(post)
      .select(() => ({
        total: count(),
      }))
      .groupBy("title")
      // @ts-expect-error A count takes a number.
      .having((_columns, selected) => selected.total.gt("1"))
    from(post)
      .select("*")
      .groupBy("id")
      .having((_columns, selected) => selected.title.ilike("a%"))
  })

  test("gives the callback the value of a query of values, and nothing after an aggregate method, exists, or map", () => {
    const groups = from(post).groupBy("title")
    groups.pluck(() => count()).having((_columns, value) => value.gt(1))
    // @ts-expect-error A count takes a number.
    groups.pluck(() => count()).having((_columns, value) => value.gt("1"))

    groups.count().having((_columns, selected) => {
      expectTypeOf(selected).toEqualTypeOf<undefined>()
      return count().gt(1)
    })
    groups.exists().having((_columns, selected) => {
      expectTypeOf(selected).toEqualTypeOf<undefined>()
      return count().gt(1)
    })
    groups
      .select("title")
      .map(row => row.title)
      .having((_columns, selected) => {
        expectTypeOf(selected).toEqualTypeOf<undefined>()
        return count().gt(1)
      })
  })

  test("types a field by its latest selection, as the result does", () => {
    const total: { total?: ReturnType<typeof count> } = {}
    from(post)
      .select(columns => ({
        "0": columns.title,
        total: count(),
      }))
      .select(() => ({
        0: count(),
      }))
      .select(() => total)
      .groupBy("title")
      .having((_columns, selected) => and(selected["0"].gt(1), selected.total.gt(1)))
    from(post)
      .select(columns => ({
        "0": columns.title,
      }))
      .select(() => ({
        0: count(),
      }))
      .groupBy("title")
      // @ts-expect-error The count replaced the text field.
      .having((_columns, selected) => selected["0"].eq("x"))
    const label: { total?: ColumnRefs<typeof post>["title"] } = {}
    from(post)
      .select(() => ({
        total: count(),
      }))
      .select(() => label)
      .groupBy("title")
      // @ts-expect-error The count stays without the optional replacement, and it takes no text.
      .having((_columns, selected) => selected.total.eq("x"))
  })

  test("takes for a field of several types only what each of them takes", () => {
    const pick = (flag: boolean) =>
      from(post)
        .select(() => ({
          value: flag ? sql(t.integer)`1` : sql(t.text)`'x'`,
        }))
        .groupBy("title")
    // @ts-expect-error The integer branch takes no text.
    pick(true).having((_columns, selected) => selected.value.eq("x"))

    const select = (flag: boolean) =>
      flag
        ? from(post).select("title")
        : from(post).select(columns => ({
            title: columns.title,
          }))
    select(true)
      .groupBy("title")
      .having((_columns, selected) => selected.title.eq("x"))

    // Each branch selects a further field, so that TypeScript compares the types of the earlier fields when it reduces their union.
    const expression = from(post)
      .select(() => ({
        value: sql(t.integer)`1`,
      }))
      .select("title")
    const code = from(post)
      .select(() => ({
        value: literal(1 as number),
      }))
      .select("title")
    const either = (flag: boolean) => (flag ? expression : code)
    // @ts-expect-error The field of a literal has no operators.
    either(true).having((_columns, selected) => selected.value.gt(1))
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
        otherCount: from(post).count(),
      }))
      .orderBy((columns, selected) => {
        expectTypeOf(columns).toEqualTypeOf<ColumnRefs<typeof post> & EmptyRecord>()
        expectTypeOf(selected).toEqualTypeOf<{
          readonly id: AnyExpression<string>
          readonly heading: AnyExpression<string>
          readonly others: AnyExpression<{ id: string }[]>
          readonly otherCount: AnyExpression<number>
        }>()
        return [
          desc(selected.heading),
          orderBy(columns.hint, "asc nulls first"),
          selected.otherCount,
          sql`random()`,
        ]
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

  test("accepts only expressions, queries of one value, and sort keys from the callback", () => {
    from(post).orderBy(columns => [
      from(post).count(),
      desc(from(post).where({ id: columns.id }).get("title")),
      orderBy(from(post).exists(), "desc nulls last"),
    ])

    // @ts-expect-error A sort key is an expression or a query of one value, not a column key.
    from(post).orderBy(() => "title")
    // @ts-expect-error A sort key is an expression or a query of one value, not of an array.
    from(post).orderBy(() => [from(post).pluck("title")])
    // @ts-expect-error A sort key is a query of one value, not of a record.
    from(post).orderBy(() => desc(from(post).select("id").take()))
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

describe("distinct", () => {
  test("keeps the state of a query of many rows, so that a conditional call assigns back to its variable", () => {
    const base = from(post).select("id")
    expectTypeOf(base.distinct()).toEqualTypeOf<typeof base>()

    let query = base
    query = query.distinct()
    expectTypeOf(query.select("title").take()).toEqualTypeOf(base.select("title").take())
    expectTypeOf(from(post).distinct().pluck("title").distinct().get("id")).toEqualTypeOf(
      from(post).pluck("title").get("id"),
    )
  })

  test("applies to a union of queries", () => {
    const query = Math.random() > 0.5 ? from(post).select("id") : from(post).select("title")
    expectTypeOf(query.distinct()).toEqualTypeOf(query)
  })

  test("rejects a query of one row", () => {
    // @ts-expect-error A query of one row must find a second row to reject it.
    from(post).take().distinct()
    // @ts-expect-error A query of one row must find a second row to reject it.
    from(post).get("title").distinct()
    // @ts-expect-error An aggregate query has one row.
    from(post).count().distinct()
    // @ts-expect-error A query of exists has one row.
    from(post).exists().distinct()
  })
})

describe("distinctOn", () => {
  test("keeps the state of a query of many rows, so that a conditional call assigns back to its variable", () => {
    const base = from(post).select("id")
    expectTypeOf(base.distinctOn("title")).toEqualTypeOf<typeof base>()

    let query = base
    query = query.distinctOn("title", "hint")
    expectTypeOf(query.select("title").take()).toEqualTypeOf(base.select("title").take())
  })

  test("passes the columns and the selected fields to the callback of a query of records, the value to that of pluck, and only the columns to that of map", () => {
    const selected = from(post)
      .select("id")
      .distinctOn((columns, fields) => {
        expectTypeOf(fields.id).toEqualTypeOf<AnyExpression<string>>()
        return [columns.title, fields.id]
      })
    expectTypeOf<Executed<typeof selected>>().toEqualTypeOf<{ id: string }[]>()

    const titles = from(post)
      .pluck("hint")
      .distinctOn((columns, value) => {
        expectTypeOf(value).toEqualTypeOf<AnyExpression<string | null>>()
        return [value, columns.title]
      })
    expectTypeOf<Executed<typeof titles>>().toEqualTypeOf<(string | null)[]>()

    const mapped = from(post)
      .select("title")
      .map(row => row.title.length)
      .distinctOn((...args) => {
        expectTypeOf(args).toEqualTypeOf<[ColumnRefs<typeof post> & EmptyRecord]>()
        return args[0].title
      })
    expectTypeOf<Executed<typeof mapped>>().toEqualTypeOf<number[]>()
  })

  test("rejects a query of one row and a key that is no column", () => {
    // @ts-expect-error A query of one row must find a second row to reject it.
    from(post).take().distinctOn("title")
    // @ts-expect-error A query of one row must find a second row to reject it.
    from(post).get("title").distinctOn("title")
    // @ts-expect-error An aggregate query has one row.
    from(post).count().distinctOn("title")
    from(post)
      .select(columns => ({
        heading: columns.title,
      }))
      // @ts-expect-error A selected field is no column.
      .distinctOn("heading")
    // @ts-expect-error A key is an expression or a query of one value.
    from(post).distinctOn(() => "title")
  })
})

describe("row locks", () => {
  test("keep the state of a query of any rows, so that a conditional call assigns back to its variable", () => {
    const base = from(post).select("id")
    expectTypeOf(base.forUpdate()).toEqualTypeOf<typeof base>()
    expectTypeOf(base.forNoKeyUpdate()).toEqualTypeOf<typeof base>()
    expectTypeOf(base.forShare()).toEqualTypeOf<typeof base>()
    expectTypeOf(base.forKeyShare()).toEqualTypeOf<typeof base>()

    let query = base
    query = query.forUpdate()
    expectTypeOf(query.select("title").take()).toEqualTypeOf(base.select("title").take())

    const values = from(post).get("title")
    expectTypeOf(values.forUpdate()).toEqualTypeOf<typeof values>()
    const mapped = from(post)
      .select("id")
      .map(({ id }) => id)
    expectTypeOf(mapped.forUpdate()).toEqualTypeOf<typeof mapped>()
  })

  test("apply to a union of queries", () => {
    const query = Math.random() > 0.5 ? from(post).select("id") : from(post).select("title")
    expectTypeOf(query.forUpdate()).toEqualTypeOf(query)
  })

  test("apply to a bound query and to a query in an expression", async () => {
    const id = await db.$transaction(async () => await db.post.take().forUpdate().get("id"))
    expectTypeOf(id).toEqualTypeOf<string>()

    const titled = db.post.where(columns =>
      columns.title.eq(db.post.take().get("title").forShare()),
    )
    expectTypeOf(titled).toEqualTypeOf(db.post)
  })

  test("take either noWait or skipLocked", () => {
    from(post).forUpdate({ noWait: true })
    from(post).forUpdate({ skipLocked: true })
    from(post).forUpdate({ noWait: false, skipLocked: true })
    from(post).forUpdate({ noWait: Math.random() > 0.5 })
    // @ts-expect-error A query either rejects or skips a locked row.
    from(post).forUpdate({ noWait: true, skipLocked: true })
    // @ts-expect-error Not an option.
    from(post).forUpdate({ wait: false })
  })

  test("reject a query that returns no rows of its table", () => {
    // @ts-expect-error An aggregate query returns no rows of its table.
    from(post).count().forUpdate()
    // @ts-expect-error An aggregate query returns no rows of its table.
    from(post).max("title").forShare()
    // @ts-expect-error A query of exists returns no rows of its table.
    from(post).exists().forUpdate()
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

  test("keeps only methods that keep the state after branches that leave different states", () => {
    const pick = (single: boolean) =>
      db.post.use(posts => (single ? posts.select("id").take() : posts.select("title")))

    const query = pick(true).where({ title: "First" }).orderBy("id")
    expectTypeOf<Awaited<typeof query>>().toEqualTypeOf<{ id: string } | { title: string }[]>()
    // @ts-expect-error A method that changes the state takes a query of one state.
    query.select("hint")
    // @ts-expect-error A method that changes the state takes a query of one state.
    query.take()
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
