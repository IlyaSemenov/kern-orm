// Verifies a history with its migration tests, both listed by import.meta.glob, as the documentation shows for Vitest, in PostgreSQL at DATABASE_URL.

import { defineMigrations } from "@kern-orm/migrations"
import { verifyMigrations } from "@kern-orm/migrations/testing"
import { postgresJsDriver } from "@kern-orm/postgres-js"
import { createDatabase } from "kern-orm"
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
