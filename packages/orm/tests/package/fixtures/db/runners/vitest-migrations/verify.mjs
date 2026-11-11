// Verifies a history with its migration tests, both listed by import.meta.glob, as the documentation shows for Vitest, in PostgreSQL at DATABASE_URL.

import { createDatabase } from "kern-db"
import { postgresJsDriver } from "kern-db/postgres-js"
import { defineMigrations } from "kern-migrations"
import { verifyMigrations } from "kern-migrations/testing"
import postgres from "postgres"
import { afterAll, expect, test } from "vitest"

const database = createDatabase({ driver: postgresJsDriver(postgres(process.env.DATABASE_URL)) })
afterAll(() => database.close())

test("verifies the migrations with their migration tests", async () => {
  globalThis.migrationTestCalls = []

  await verifyMigrations(
    database,
    defineMigrations(
      import.meta.glob(["./migrations/*.mjs", "!./migrations/*.migration-test.mjs"]),
    ),
    { tests: import.meta.glob("./migrations/*.migration-test.mjs") },
  )

  expect(globalThis.migrationTestCalls).toEqual(["assertUp"])
})
