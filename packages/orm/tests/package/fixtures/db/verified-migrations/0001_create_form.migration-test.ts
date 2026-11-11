import assert from "node:assert/strict"

import * as t from "kern-db/types"
import { defineMigrationTest } from "kern-migrations/testing"

const { migrationTestCalls: calls } = globalThis as unknown as { migrationTestCalls: string[] }

export default defineMigrationTest("stores forms", {
  assertUp: async database => {
    await database.query`INSERT INTO form (id, name) VALUES (1, 'Survey')`
    assert.deepEqual(await database.query`SELECT name FROM form`.pluck(t.text), ["Survey"])
    calls.push("assertUp")
  },
  assertDown: async () => {
    calls.push("assertDown")
  },
})
