import { defineMigrationTest } from "@kern-orm/migrations/testing"
import * as t from "kern-orm/types"
import { expect } from "vitest"

export default defineMigrationTest("stores forms", {
  assertUp: async database => {
    await database.query`INSERT INTO form (id, name) VALUES (1, 'Survey')`
    expect(await database.query`SELECT name FROM form`.pluck(t.text)).toEqual(["Survey"])
    globalThis.migrationTestCalls.push("assertUp")
  },
})
