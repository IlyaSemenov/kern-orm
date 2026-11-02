import { describe, test } from "bun:test"

import type { MigrationError } from "../error"

import { defineMigrationTest } from "./migration-test"

describe("defineMigrationTest", () => {
  test("gives the callbacks the database of the migration and assertUpError its MigrationError", () => {
    defineMigrationTest("fills slugs", {
      setup: async database => {
        await database.query`INSERT INTO form (name) VALUES (${"Survey"})`
      },
      assertUp: async database => {
        await database.script("SELECT slug FROM form")
        // @ts-expect-error -- a migration test must not close the database
        await database.close()
      },
      assertDown: async database => {
        await database.script("SELECT name FROM form")
      },
    })
    defineMigrationTest("rejects forms of one slug", {
      setup: database => database.script("INSERT INTO form (name) VALUES ('A'), ('a')"),
      assertUpError: (error: MigrationError, database) => database.script(`SELECT ${error.step}`),
    })
  })

  test("rejects assertUpError together with assertUp or assertDown", () => {
    // @ts-expect-error -- a migration test with assertUpError has no assertUp or assertDown
    defineMigrationTest("rejects forms of one slug", {
      assertUp: async () => {},
      assertUpError: () => {},
    })
    // @ts-expect-error -- a migration test with assertUpError has no assertUp or assertDown
    defineMigrationTest("rejects forms of one slug", {
      assertUpError: () => {},
      assertDown: async () => {},
    })
  })

  test("rejects a misspelled callback", () => {
    defineMigrationTest("fills slugs", {
      setup: async () => {},
      // @ts-expect-error -- a misspelled assertDown would never run
      assertDonw: async () => {},
    })
  })
})
