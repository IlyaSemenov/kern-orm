// Test helpers of the node:test scenario with a seed that never settles, whose before hooks time out quickly.
import { after, before } from "node:test"

import { createTestHelpers } from "kern-orm/testing"

import { database } from "../database.mjs"

export const { testTransaction, useTestFixture } = createTestHelpers(database, {
  before: hook => before(hook, { timeout: 50 }),
  after,
})
