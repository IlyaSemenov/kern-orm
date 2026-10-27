// Test helpers of the node:test scenario.
import { after, before } from "node:test"

import { createTestHelpers } from "kern-orm/testing"

import { database } from "../database.mjs"

export const { testTransaction, useTestFixture } = createTestHelpers(database, {
  before,
  after,
})
