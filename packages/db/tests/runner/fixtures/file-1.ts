// A test file with its own fixture, whose first test times out while its code keeps querying.
import { test } from "bun:test"

import { lateResults, run, testTransaction, useTestFixture } from "./database"

const nextStarted = Promise.withResolvers<void>()
const lateFinished = Promise.withResolvers<void>()

useTestFixture(() => run("file 1 data"))

test(
  "times out",
  () =>
    testTransaction(async () => {
      await run("timed out")
      await nextStarted.promise
      await run("late").catch((error: Error) => lateResults.push(error.message))
      lateFinished.resolve()
    }),
  50,
)

test("runs after the timed-out test", () =>
  testTransaction(async () => {
    nextStarted.resolve()
    await run("next")
    await lateFinished.promise
  }))
