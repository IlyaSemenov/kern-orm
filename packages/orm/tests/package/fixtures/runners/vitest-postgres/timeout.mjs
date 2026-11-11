// A test times out while its query runs in PostgreSQL, in a fixture and without one.
import { describe, test } from "vitest"

import { defineTimeoutTests } from "../postgres.mjs"

import { useTestFixture } from "./helpers.mjs"

describe("in a fixture", () => {
  useTestFixture(async () => {})

  defineTimeoutTests(test)
})

describe("without a fixture", () => {
  defineTimeoutTests(test)
})
