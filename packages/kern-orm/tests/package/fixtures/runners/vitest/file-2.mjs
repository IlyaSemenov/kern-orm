// A test file with a fixture of a describe block and a hook that runs in the test transaction of each test.
import { beforeEach, describe, test } from "vitest"

import { run } from "../database.mjs"

import { useTestFixture } from "./helpers.mjs"

describe("with a fixture", () => {
  const fixture = useTestFixture(async () => {
    await run("file data")
    return { text: "test" }
  })

  beforeEach(() => run("before each"))

  test("runs in the fixture of its describe block", () => run(fixture.data.text))
})
