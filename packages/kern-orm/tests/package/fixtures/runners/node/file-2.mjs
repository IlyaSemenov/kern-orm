// A test file with a fixture of a describe block.
import { describe, test } from "node:test"

import { run } from "../database.mjs"

import { testTransaction, useTestFixture } from "./helpers.mjs"

describe("with a fixture", () => {
  const fixture = useTestFixture(async () => {
    await run("file data")
    return { text: "test" }
  })

  test("runs in the fixture of its describe block", () =>
    testTransaction(() => run(fixture.data.text)))
})
