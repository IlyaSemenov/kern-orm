// A test file with a fixture of a describe block, run after file-1.ts.
import { describe, test } from "bun:test"

import { run, testTransaction, useTestFixture } from "./database"

describe("with a fixture", () => {
  const fixture = useTestFixture(async () => {
    await run("file 2 data")
    return { text: "file 2 test" }
  })

  test("runs in the fixture of its describe block", () =>
    testTransaction(() => run(fixture.data.text)))
})
