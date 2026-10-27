import { describe, expectTypeOf, test } from "bun:test"

import { createRecordingDriver } from "../../testing/recording-driver"
import { createDatabase } from "../execution/database"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

const form = defineTable("form", {
  id: t.integer.primaryKey(),
})

const database = createDatabase({ driver: createRecordingDriver().driver })
const db = database.bind(defineSchema({ form }))

describe("results", () => {
  test("are the number of the rows of the command tag without a selection", async () => {
    expectTypeOf(await db.$query`UPDATE ${db.form} SET id = id`).toEqualTypeOf<number>()
    expectTypeOf(await db.$query`UPDATE`.take().optional()).toEqualTypeOf<number>()
    expectTypeOf(await database.query`SET LOCAL lock_timeout = '1s'`).toEqualTypeOf<number>()
  })

  test("are the records of the types of select, which adds fields and replaces them under their keys", async () => {
    const query = db.$query`SELECT`.select({
      id: t.integer,
      note: t.text.nullable(),
    })

    expectTypeOf(await query).toEqualTypeOf<{ id: number; note: string | null }[]>()
    expectTypeOf(
      await query.select({
        id: t.text,
      }),
    ).toEqualTypeOf<{ id: string; note: string | null }[]>()
  })

  test("are one record after take, optional, and nullable, before or after select", async () => {
    const fields = {
      id: t.integer,
    }

    expectTypeOf(await db.$query`SELECT`.select(fields).take()).toEqualTypeOf<{ id: number }>()
    expectTypeOf(await db.$query`SELECT`.take().select(fields)).toEqualTypeOf<{ id: number }>()
    expectTypeOf(await db.$query`SELECT`.select(fields).take().optional()).toEqualTypeOf<
      { id: number } | undefined
    >()
    expectTypeOf(await db.$query`SELECT`.take().nullable().select(fields)).toEqualTypeOf<{
      id: number
    } | null>()
  })

  test("are values of get and pluck", async () => {
    expectTypeOf(await db.$query`SELECT`.get(t.bigint)).toEqualTypeOf<bigint>()
    expectTypeOf(await db.$query`SELECT`.get(t.bigint).optional()).toEqualTypeOf<
      bigint | undefined
    >()
    expectTypeOf(await db.$query`SELECT`.pluck(t.text.nullable())).toEqualTypeOf<
      (string | null)[]
    >()
    expectTypeOf(await db.$query`SELECT`.take().pluck(t.text)).toEqualTypeOf<string>()
  })
})

describe("methods", () => {
  test("reject optional of many rows, nullable of values, select after get or pluck, and a field of a symbol key", () => {
    // @ts-expect-error A query of many rows is not optional.
    db.$query`SELECT`.select({ id: t.integer }).optional()
    // @ts-expect-error A missing value is `undefined`, never `null`.
    db.$query`SELECT`.get(t.integer).nullable()
    // @ts-expect-error A query of values selects no records.
    db.$query`SELECT`.pluck(t.integer).select({ id: t.integer })
    // @ts-expect-error A field has a string key.
    db.$query`SELECT`.select({ [Symbol("id")]: t.integer })
  })
})
