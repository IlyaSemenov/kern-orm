// A test file whose first describe block has a fixture with a seed that never settles, followed by a describe block with its own fixture.
import { describe, test } from "vitest"

import { run } from "../database.mjs"

import { useTestFixture } from "./helpers.mjs"

describe("with a stuck fixture", () => {
  useTestFixture(async () => {
    await run("stuck data")
    await new Promise(() => {})
  })

  test("never runs", () => run("stuck test"))
})

describe("with the next fixture", () => {
  useTestFixture(() => run("file data"))

  test("runs in the fixture of its describe block", () => run("test"))
})
