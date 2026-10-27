// Database shared by the preload and the test files that test-runner.test.ts runs under `bun test`.
import { afterAll, beforeAll } from "bun:test"

import { createDatabase, createStatement } from "kern-orm"
import { createTestHelpers } from "kern-orm/testing"

import { createRecordingDriver } from "../../../testing/recording-driver"

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
