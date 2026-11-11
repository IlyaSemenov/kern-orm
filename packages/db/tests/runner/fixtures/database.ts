// Database shared by the preload and the test files that test-runner.test.ts runs under `bun test`.
import { afterAll, beforeAll } from "bun:test"

import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"
import { createDatabase, createStatement } from "kern-db"
import { createTestHelpers } from "kern-db/testing"

export const { driver, statements, releases } = createRecordingDriver()

const database = createDatabase({ driver, test: true })

export const { testTransaction, useTestFixture } = createTestHelpers(database, {
  before: beforeAll,
  after: afterAll,
})

/** Messages of late queries of a test that timed out. */
export const lateResults: string[] = []

/** Executes a statement named `text`. */
export async function run(text: string): Promise<void> {
  await database.execute(createStatement(text))
}
