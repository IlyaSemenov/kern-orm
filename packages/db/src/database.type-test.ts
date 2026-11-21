import { describe, expectTypeOf, test } from "bun:test"

import type { Database, ExternalConnection, OpenedSession } from "./database"
import { identifier, sql } from "./sql/fragment"

declare const database: Database
declare const connection: ExternalConnection
declare const session: OpenedSession

describe("script", () => {
  test("takes a text, or a template of fragments", () => {
    void database.script("ANALYZE form")
    void database.script`ANALYZE ${identifier("form")}; ${sql`ANALYZE field`}`
  })

  test("rejects an object of the members of a fragment and a copy of a fragment, which only the functions of fragments create", () => {
    const shaped = { strings: ["ANALYZE form"], values: [] }
    const copy = { ...sql`ANALYZE form` }

    // @ts-expect-error A fragment is created by sql, identifier, or param.
    void database.script`${shaped}`
    // @ts-expect-error A copy of a fragment is not a fragment.
    void database.script`${copy}`
  })
})

describe("transactions and sessions", () => {
  test("take a callback that returns a query and give the result of the query", () => {
    expectTypeOf(database.transaction(() => database.query`SELECT 1`)).toEqualTypeOf<
      Promise<number>
    >()
    expectTypeOf(
      database.externalTransaction(connection, () => database.query`SELECT 1`),
    ).toEqualTypeOf<Promise<number>>()
    expectTypeOf(database.ensureTransaction(() => database.query`SELECT 1`)).toEqualTypeOf<
      Promise<number>
    >()
    expectTypeOf(database.session(() => database.query`SELECT 1`)).toEqualTypeOf<Promise<number>>()
    expectTypeOf(session.run(() => database.query`SELECT 1`)).toEqualTypeOf<Promise<number>>()
  })

  test("take an async callback and give its result", () => {
    expectTypeOf(database.transaction(async () => 1)).toEqualTypeOf<Promise<number>>()
  })

  test("reject a callback whose result does not fit PromiseLike, such as a value", () => {
    // @ts-expect-error The result of the callback must fit PromiseLike.
    void database.transaction(() => 1)
    // @ts-expect-error The result of the callback must fit PromiseLike.
    void session.run(() => undefined)
  })
})
