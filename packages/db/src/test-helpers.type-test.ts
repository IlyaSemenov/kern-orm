import { describe, expectTypeOf, test } from "bun:test"

import type { Database } from "./database"
import type { OpenedTestFixture, OpenedTestTransaction, TestHelpers } from "./test-helpers"
import { openTestFixture } from "./test-helpers"

declare const database: Database
declare const helpers: TestHelpers
declare const opened: OpenedTestTransaction

describe("test transactions and fixtures", () => {
  test("infer the query result for transaction results and fixture data", () => {
    expectTypeOf(helpers.testTransaction(() => database.query`SELECT 1`)).toEqualTypeOf<
      Promise<number>
    >()
    expectTypeOf(opened.run(() => database.query`SELECT 1`)).toEqualTypeOf<Promise<number>>()
    expectTypeOf(
      helpers.useTestFixture(() => database.query`SELECT 1`).data,
    ).toEqualTypeOf<number>()
    expectTypeOf(openTestFixture(database, () => database.query`SELECT 1`)).toEqualTypeOf<
      Promise<OpenedTestFixture<number>>
    >()
  })

  test("reject a callback whose result does not fit PromiseLike, such as a value", () => {
    // @ts-expect-error The result of the callback must fit PromiseLike.
    void helpers.testTransaction(() => 1)
    // @ts-expect-error The result of the seed must fit PromiseLike.
    helpers.useTestFixture(() => ({ id: 1 }))
  })
})
