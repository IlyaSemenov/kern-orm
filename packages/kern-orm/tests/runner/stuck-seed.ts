// Tests run by test-runner.test.ts under `bun test`: the before hook of the first describe block times out while the seed of its fixture never settles.
import { afterAll, beforeAll, describe, test } from "bun:test"

import { createDatabase, createStatement } from "kern-orm"
import { createTestHelpers } from "kern-orm/testing"

import { createRecordingDriver } from "../../testing/recording-driver"

const { driver, statements, releases } = createRecordingDriver()
const database = createDatabase({ driver, test: true })
const { testTransaction, useTestFixture } = createTestHelpers(database, {
  before: hook => beforeAll(hook, { timeout: 50 }),
  after: afterAll,
})

/** Executes a statement named `text`. */
async function run(text: string): Promise<void> {
  await database.execute(createStatement(text))
}

useTestFixture(() => run("migrate"))

describe("with a stuck fixture", () => {
  useTestFixture(async () => {
    await run("stuck data")
    await new Promise<never>(() => {})
  })

  test("never runs", () => testTransaction(() => run("stuck test")))
})

describe("with the next fixture", () => {
  useTestFixture(() => run("next data"))

  test("runs in the fixture of its describe block", () => testTransaction(() => run("next test")))
})

afterAll(() => {
  console.log(`RESULT ${JSON.stringify({ statements, releases })}`)
})
