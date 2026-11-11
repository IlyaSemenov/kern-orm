// Test helpers of the Vitest scenario in PostgreSQL.
import { createTestHelpers } from "kern-orm/testing"
import { afterAll, beforeAll } from "vitest"

import { database } from "../postgres.mjs"

export const { testTransaction, useTestFixture } = createTestHelpers(database, {
  before: beforeAll,
  after: afterAll,
})
