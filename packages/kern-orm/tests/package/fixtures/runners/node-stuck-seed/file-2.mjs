// A test file whose own fixture has a seed that never settles; node:test closes the fixture of --import before it.
import { test } from "node:test"

import { run } from "../database.mjs"

import { testTransaction, useTestFixture } from "./helpers.mjs"

useTestFixture(async () => {
  await run("stuck data")
  await new Promise(() => {})
})

test("never runs", () => testTransaction(() => run("stuck test")))
