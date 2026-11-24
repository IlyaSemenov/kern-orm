import { describe, expectTypeOf, test } from "bun:test"

import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"

import type { Database } from "../database"
import { createDatabase } from "../database"
import type { Connection, Driver, DriverResult, SqlStatement } from "../driver"
import { bigint, integer } from "../type/builtins/numeric"
import { text } from "../type/builtins/text"

import { createSqlColumns } from "./columns"
import type { InitialSqlQueryState, SqlQuery } from "./query"
import { queryOn } from "./query"

const database = createDatabase({ driver: createRecordingDriver().driver })

describe("queryOn", () => {
  test("takes a database, a driver, a connection, and an object with execute, and starts the query of a database", () => {
    const template = (
      executor:
        | Database
        | Driver
        | Connection
        | { execute: (statement: SqlStatement) => Promise<DriverResult> },
    ) => queryOn(executor)`SELECT ${1}`

    expectTypeOf(template).returns.toEqualTypeOf<SqlQuery<InitialSqlQueryState>>()
    expectTypeOf(queryOn(database)).toEqualTypeOf<Database["query"]>()
  })

  test("rejects an object that does not execute statements, and a value that its template does not take", () => {
    // @ts-expect-error An executor returns the result of a driver.
    queryOn({ execute: async (statement: SqlStatement) => statement })
    // @ts-expect-error An object is not the value of a parameter without a type.
    void queryOn(database)`SELECT ${{ id: 1 }}`
  })
})

describe("results", () => {
  test("are the number of the rows of the command tag without a selection", async () => {
    expectTypeOf(await database.query`UPDATE form SET id = id`).toEqualTypeOf<number>()
    expectTypeOf(await database.query`UPDATE`.take().optional()).toEqualTypeOf<number>()
  })

  test("are the records of the types of select, which adds fields and replaces them under their keys", async () => {
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

  test("have the records of the columns of select under their keys, null of nullable columns, replaced as other fields are", async () => {
    const columns = [
      { key: "id", name: "id", type: integer },
      { key: "note", name: "note", type: text.nullable() },
    ] as const
    const job = createSqlColumns(columns, { alias: "j", key: ["id"] })
    const claimed = createSqlColumns(columns, { alias: "c", key: ["id"] }).nullable()
    const query = database.query`SELECT`.select({
      job,
      claimed,
      lag: integer,
    })

    expectTypeOf(await query).toEqualTypeOf<
      {
        job: { id: number; note: string | null }
        claimed: { id: number; note: string | null } | null
        lag: number
      }[]
    >()
    expectTypeOf(
      await query.select({
        claimed: text,
        job: claimed,
      }),
    ).toEqualTypeOf<
      {
        job: { id: number; note: string | null } | null
        claimed: string
        lag: number
      }[]
    >()
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

  test("stay the same after comment, in every state", async () => {
    expectTypeOf(await database.query`SELECT`.comment("c")).toEqualTypeOf<number>()
    expectTypeOf(
      await database.query`SELECT`
        .comment("c")
        .select({ id: integer })
        .take()
        .comment(null)
        .optional(),
    ).toEqualTypeOf<{ id: number } | undefined>()
    expectTypeOf(await database.query`SELECT`.get(bigint).comment("c").optional()).toEqualTypeOf<
      bigint | undefined
    >()
    expectTypeOf(
      await database.query`SELECT`.take().comment("c").nullable(),
    ).toEqualTypeOf<number>()
  })
})

describe("catch and finally", () => {
  const query = database.query`SELECT`.get(integer)

  test("give a Promise of the result, for catch also of the result of its callback", () => {
    expectTypeOf(query.catch()).toEqualTypeOf<Promise<number>>()
    expectTypeOf(query.catch(() => null)).toEqualTypeOf<Promise<number | null>>()
    expectTypeOf(query.catch(async (error: unknown) => String(error))).toEqualTypeOf<
      Promise<number | string>
    >()
    expectTypeOf(query.finally()).toEqualTypeOf<Promise<number>>()
    expectTypeOf(query.finally(() => {})).toEqualTypeOf<Promise<number>>()
  })

  test("do not make a query a Promise, which has started and settles once", () => {
    expectTypeOf(query).toExtend<PromiseLike<number>>()
    // A query executes with each call of then, catch, and finally, so it is no Promise.
    expectTypeOf(query).not.toExtend<Promise<number>>()
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
