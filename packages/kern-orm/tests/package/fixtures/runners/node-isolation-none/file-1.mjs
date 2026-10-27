// A test file whose fixture belongs to a describe block, since all test files load before their tests run.
import { describe, test } from "node:test"

import { run } from "../database.mjs"
import { testTransaction, useTestFixture } from "../node/helpers.mjs"

describe("with a fixture", () => {
  useTestFixture(() => run("file data"))

  test("runs in the fixture of its describe block", () => testTransaction(() => run("test")))
})
