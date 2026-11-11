// Test helpers of the Vitest scenario with a seed that never settles, whose before hooks time out quickly.
import { createTestHelpers } from "kern-orm/testing"
import { afterAll, beforeAll } from "vitest"

import { database } from "../database.mjs"

export const { testTransaction, useTestFixture } = createTestHelpers(database, {
  before: hook => beforeAll(hook, 50),
  after: afterAll,
})
