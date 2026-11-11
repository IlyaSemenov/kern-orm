// A test times out while its query runs in PostgreSQL, in a fixture and without one; test transactions take t.signal, which node:test also aborts after a test passes.
import { after, before, describe, test } from "node:test"

import { createTestHelpers } from "kern-orm/testing"

import { database, defineTimeoutTests } from "../postgres.mjs"

const { testTransaction, useTestFixture } = createTestHelpers(database, { before, after })

after(() => database.close())

/** Registers a test that runs `body` in a test transaction with the signal of the test. */
function defineTest(name, body, timeout) {
  test(name, { timeout }, t => testTransaction(body, { signal: t.signal }))
}

describe("in a fixture", () => {
  useTestFixture(async () => {})

  defineTimeoutTests(defineTest)
})

describe("without a fixture", () => {
  defineTimeoutTests(defineTest)
})
