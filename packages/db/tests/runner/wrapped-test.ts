// Tests run by test-runner.test.ts under `bun test`, declared with `test` of `bun:test` wrapped by `wrapTest`: the first one times out while its code keeps querying, and the first attempt of a retried one times out.
import { afterAll, beforeAll, describe, onTestFinished, test as bunTest } from "bun:test"

import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"
import { createDatabase, createStatement } from "kern-db"
import { createTestHelpers } from "kern-db/testing"

const { driver, statements } = createRecordingDriver()
const database = createDatabase({ driver, test: true })
const { useTestFixture, wrapTest } = createTestHelpers(database, {
  before: beforeAll,
  after: afterAll,
  onTestFinished,
})
const test = wrapTest(bunTest)
const lateResults: string[] = []
const lateFinished = Promise.withResolvers<void>()

/** Executes a statement named `text`. */
async function run(text: string): Promise<void> {
  await database.execute(createStatement(text))
}

test("times out", async () => {
  await run("timed out")
  await Bun.sleep(100)
  await run("late").catch((error: Error) => lateResults.push(error.message))
  lateFinished.resolve()
}, 50)

test("runs after the timed-out test", async () => {
  await run("next")
  await lateFinished.promise
})

test("fails", async () => {
  await run("fails")
  throw new Error("The test fails")
})

let attempt = 0

test(
  "is retried after a timeout",
  async () => {
    attempt += 1
    await run(`attempt ${attempt}`)
    if (attempt === 1) {
      await new Promise<never>(() => {})
    }
  },
  { timeout: 50, retry: 1 },
)

test.each([["row 1"], ["row 2"]])("runs %s", text => run(text))

test.skip("is skipped", () => run("skipped"))

test.if(true)("runs under a condition", () => run("conditional"))

describe("with a fixture", () => {
  const fixture = useTestFixture(async () => {
    await run("fixture data")
    return { text: "fixture test" }
  })

  test("runs in the fixture of its describe block", () => run(fixture.data.text))
})

afterAll(() => {
  console.log(`RESULT ${JSON.stringify({ statements, lateResults })}`)
})
