import { createTestHelpers } from "kern-orm/testing"
// Test helpers of the Vitest scenario.
import { afterAll, beforeAll } from "vitest"

import { database } from "../database.mjs"

export const { testTransaction, useTestFixture } = createTestHelpers(database, {
  before: beforeAll,
  after: afterAll,
})
