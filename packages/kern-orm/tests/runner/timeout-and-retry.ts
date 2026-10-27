// Tests run by test-runner.test.ts under `bun test`: the first one times out while its code keeps querying, and the last one is retried.
import { afterAll, beforeAll, test } from "bun:test"

import { createDatabase, createStatement } from "kern-orm"
import { createTestHelpers } from "kern-orm/testing"

import { createRecordingDriver } from "../../testing/recording-driver"

const { driver, statements } = createRecordingDriver()
const database = createDatabase({ driver, test: true })
const { testTransaction } = createTestHelpers(database, { before: beforeAll, after: afterAll })
const nextStarted = Promise.withResolvers<void>()
const lateFinished = Promise.withResolvers<void>()
const lateResults: string[] = []

test(
  "times out",
  () =>
    testTransaction(async () => {
      await database.execute(createStatement("timed out"))
      await nextStarted.promise
      await database.execute(createStatement("late while running"))
      // A timer keeps the async context of the test and fires after its transaction has ended.
      setTimeout(() => {
        database
          .execute(createStatement("late after end"))
          .then(
            () => lateResults.push("ran"),
            (error: Error) => lateResults.push(error.message),
          )
          .finally(lateFinished.resolve)
      })
    }),
  50,
)

test("runs after the timed-out test", () =>
  testTransaction(async () => {
    nextStarted.resolve()
    await database.execute(createStatement("next"))
    await lateFinished.promise
  }))

let attempt = 0

test(
  "is retried",
  () =>
    testTransaction(async () => {
      attempt += 1
      await database.execute(createStatement(`attempt ${attempt}`))
      if (attempt === 1) {
        throw new Error("The first attempt fails")
      }
    }),
  { retry: 1 },
)

afterAll(() => {
  console.log(`RESULT ${JSON.stringify({ statements, lateResults })}`)
})
