import * as t from "kern-db/types"
import { defineMigrationTest } from "kern-migrations/testing"
import { expect } from "vitest"

export default defineMigrationTest("stores forms", {
  assertUp: async database => {
    await database.query`INSERT INTO form (id, name) VALUES (1, 'Survey')`
    expect(await database.query`SELECT name FROM form`.pluck(t.text)).toEqual(["Survey"])
    globalThis.migrationTestCalls.push("assertUp")
  },
})
