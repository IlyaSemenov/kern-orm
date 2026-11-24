import { describe, expectTypeOf, test } from "bun:test"

import type { JsonNull } from "kern-db"
import { jsonNull } from "kern-db"

import { caseWhen, coalesce } from "../../expression/functions"
import type { NoOperators } from "../../expression/operators/definitions"
import { param } from "../../expression/sql"
import type { QueryResult } from "../../query/rows"
import type { AnySelectQuery } from "../../query/select"
import { from } from "../../query/select"
import type { InsertValues } from "../../query/values"
import type { Selectable } from "../../table/table"
import { defineTable } from "../../table/table"
import * as t from "../../types"
import type { Type, TypeInput, TypeOutput } from "../type"

type Payload = { url?: string }
type Executed<Q extends AnySelectQuery> = QueryResult<Q["types"]>

describe("jsonWithJsonNull and jsonbWithJsonNull", () => {
  const payloadType = t.jsonbWithJsonNull.of<Payload | JsonNull>()
  const job = defineTable("job", {
    id: t.integer.primaryKey(),
    payload: payloadType,
    extra: payloadType.nullable(),
    plain: t.jsonbWithJsonNull,
    unmarked: t.jsonbWithJsonNull.of<Payload>(),
    source: t.jsonWithJsonNull.of<Payload | JsonNull>(),
    history: t.array(payloadType),
  })

  test("have the values other than null and undefined, and `jsonbWithJsonNull` the operators of equality", () => {
    expectTypeOf(t.jsonWithJsonNull).toEqualTypeOf<Type<{}, {}, NoOperators>>()
    expectTypeOf<TypeOutput<typeof t.jsonbWithJsonNull>>().toEqualTypeOf<{}>()
    expectTypeOf<TypeInput<typeof t.jsonbWithJsonNull>>().toEqualTypeOf<{}>()
    expectTypeOf(t.jsonbWithJsonNull.operators).toEqualTypeOf(t.jsonb.operators)
  })

  test("select the marker that a shape includes, apart from null of a nullable column", () => {
    type Row = Selectable<typeof job>
    expectTypeOf<Row["payload"]>().toEqualTypeOf<Payload | JsonNull>()
    expectTypeOf<Row["extra"]>().toEqualTypeOf<Payload | JsonNull | null>()
    expectTypeOf<Row["plain"]>().toEqualTypeOf<{}>()
    expectTypeOf<Row["unmarked"]>().toEqualTypeOf<Payload>()
    expectTypeOf<Row["history"]>().toEqualTypeOf<(Payload | JsonNull)[]>()
  })

  test("take the marker as a value, and null only for a nullable column", () => {
    const values: InsertValues<typeof job> = {
      id: 1,
      payload: jsonNull,
      extra: null,
      plain: jsonNull,
      unmarked: {},
      source: jsonNull,
      history: [jsonNull],
    }
    // @ts-expect-error A column that is not nullable takes no null.
    const nulls: InsertValues<typeof job>["payload"] = null
    // @ts-expect-error A shape that does not include the marker does not take it.
    const unmarked: InsertValues<typeof job>["unmarked"] = jsonNull
    void [values, nulls, unmarked]
    param(payloadType, jsonNull)
    param(payloadType.nullable(), null)
  })

  test("match the marker and null in conditions", () => {
    from(job).where({ payload: jsonNull })
    from(job).where({ extra: jsonNull })
    from(job).where({ extra: null })
    // @ts-expect-error A condition takes null only for a nullable column.
    from(job).where({ payload: null })
    // @ts-expect-error A `json` column has no equality, so no object condition of a value.
    from(job).where({ source: jsonNull })
    from(job).where(job => job.payload.in([jsonNull, { url: "/a" }]))
    // @ts-expect-error A `json` column has no `eq`.
    from(job).where(job => job.source.eq(jsonNull))
  })

  test("type expressions by null of a nullable column alone", () => {
    const query = from(job).select(job => ({
      isJsonNull: job.payload.eq(jsonNull),
      isExtraJsonNull: job.extra.eq(jsonNull),
      isPlainEmpty: job.plain.eq({}),
      isNull: job.extra.isNull(),
      fallback: coalesce(job.extra, jsonNull),
      marked: caseWhen(payloadType, [[job.extra.isNull(), jsonNull]], job.payload),
    }))
    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<
      {
        isJsonNull: boolean
        isExtraJsonNull: boolean | null
        isPlainEmpty: boolean
        isNull: boolean
        fallback: Payload | JsonNull
        marked: Payload | JsonNull
      }[]
    >()
  })

  test("reject null in a shape and `nullableAs`, whose values have no null apart from NULL", () => {
    // @ts-expect-error `nullable` adds `null`, which a shape leaves out.
    t.jsonbWithJsonNull.of<Payload | null>()
    // @ts-expect-error The values of the type have no `null` apart from `NULL`.
    payloadType.nullableAs(() => undefined)
    // @ts-expect-error The values of the type without a shape have no `null` either.
    t.jsonbWithJsonNull.nullableAs(() => undefined)
  })
})
