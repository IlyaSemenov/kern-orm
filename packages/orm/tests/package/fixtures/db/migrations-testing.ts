// Verifies a history of `kern-migrations` with the migration tests of its directory, in PostgreSQL at DATABASE_URL; prints the calls of the tests and the error of a rollback that renames the table of a migration rather than dropping it.

import { createDatabase } from "kern-db"
import { postgresJsDriver } from "kern-db/postgres-js"
import { defineMigrations } from "kern-migrations"
import { defineMigrationTest, verifyMigrations } from "kern-migrations/testing"
import postgres from "postgres"

// The migration tests of `verified-migrations/` record the calls of their callbacks here: importing this module from them would deadlock on its top-level await.
const calls: string[] = []
Object.assign(globalThis, { migrationTestCalls: calls })

// The declarations of the script name the type of a migration test.
export const migrationTest = defineMigrationTest("creates no forms", {
  assertUp: async () => {},
})

const database = createDatabase({ driver: postgresJsDriver(postgres(process.env.DATABASE_URL!)) })
try {
  await verifyMigrations(
    database,
    defineMigrations({
      "0001_create_form": () => import("./verified-migrations/0001_create_form.ts"),
    }),
    { tests: new URL("./verified-migrations/", import.meta.url) },
  )
  const failure = await verifyMigrations(
    database,
    defineMigrations({
      "0001_create_form": {
        up: "CREATE TABLE form (id integer)",
        down: "ALTER TABLE form RENAME TO survey",
      },
    }),
  ).catch((error: unknown) => (error as Error).message)
  console.log(JSON.stringify({ calls, failure }))
} finally {
  await database.close()
}
