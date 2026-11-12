// Tests declared with `test` of node:test wrapped by `wrapTest`, whose test transactions take the signal of the test context: the first one times out while its code keeps querying.
import { after, before, describe, test as nodeTest } from "node:test"
import { setTimeout } from "node:timers/promises"

import { createTestHelpers } from "kern-db/testing"

import { database, run } from "../database.mjs"

const { useTestFixture, wrapTest } = createTestHelpers(database, { before, after })
const test = wrapTest(nodeTest)

describe("without a fixture", () => {
  test("times out", { timeout: 50 }, async () => {
    await run("timed out")
    await setTimeout(200)
    await run("late").catch(() => {})
  })

  test("runs after the timed-out test", () => run("next"))

  test.skip("is skipped", () => run("skipped"))
})

describe("with a fixture", () => {
  const fixture = useTestFixture(async () => {
    await run("file data")
    return { text: "test" }
  })

  test("runs in the fixture of its describe block", () => run(fixture.data.text))
})
