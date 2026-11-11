import { describe, expectTypeOf, test } from "bun:test"

import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"

import { bigint, integer } from "../codecs/numeric"
import { text } from "../codecs/text"
import { createDatabase } from "../database"

const database = createDatabase({ driver: createRecordingDriver().driver })

describe("results", () => {
  test("are the number of the rows of the command tag without a selection", async () => {
    expectTypeOf(await database.query`UPDATE form SET id = id`).toEqualTypeOf<number>()
    expectTypeOf(await database.query`UPDATE`.take().optional()).toEqualTypeOf<number>()
  })

  test("are the records of the codecs of select, which adds fields and replaces them under their keys", async () => {
    const query = database.query`SELECT`.select({
      id: integer,
      note: text.nullable(),
    })

    expectTypeOf(await query).toEqualTypeOf<{ id: number; note: string | null }[]>()
    expectTypeOf(
      await query.select({
        id: text,
      }),
    ).toEqualTypeOf<{ id: string; note: string | null }[]>()
  })

  test("are one record after take, optional, and nullable, before or after select", async () => {
    const fields = {
      id: integer,
    }

    expectTypeOf(await database.query`SELECT`.select(fields).take()).toEqualTypeOf<{
      id: number
    }>()
    expectTypeOf(await database.query`SELECT`.take().select(fields)).toEqualTypeOf<{
      id: number
    }>()
    expectTypeOf(await database.query`SELECT`.select(fields).take().optional()).toEqualTypeOf<
      { id: number } | undefined
    >()
    expectTypeOf(await database.query`SELECT`.take().nullable().select(fields)).toEqualTypeOf<{
      id: number
    } | null>()
  })

  test("are values of get and pluck", async () => {
    expectTypeOf(await database.query`SELECT`.get(bigint)).toEqualTypeOf<bigint>()
    expectTypeOf(await database.query`SELECT`.get(bigint).optional()).toEqualTypeOf<
      bigint | undefined
    >()
    expectTypeOf(await database.query`SELECT`.pluck(text.nullable())).toEqualTypeOf<
      (string | null)[]
    >()
    expectTypeOf(await database.query`SELECT`.take().pluck(text)).toEqualTypeOf<string>()
  })
})

describe("methods", () => {
  test("reject optional of many rows, nullable of values, select after get or pluck, and a field of a symbol key", () => {
    // @ts-expect-error A query of many rows is not optional.
    database.query`SELECT`.select({ id: integer }).optional()
    // @ts-expect-error A missing value is `undefined`, never `null`.
    database.query`SELECT`.get(integer).nullable()
    // @ts-expect-error A query of values selects no records.
    database.query`SELECT`.pluck(integer).select({ id: integer })
    // @ts-expect-error A field has a string key.
    database.query`SELECT`.select({ [Symbol("id")]: integer })
  })
})
