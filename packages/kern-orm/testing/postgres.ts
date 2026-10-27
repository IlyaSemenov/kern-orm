// PostgreSQL of the tests at `DATABASE_URL`, such as from `.env.test.local`; the tests that need it are skipped without it.
import { afterAll, beforeAll, describe } from "bun:test"

import { postgresJsDriver } from "@kern-orm/postgres-js"
import type { Database } from "kern-orm"
import { createDatabase, createStatement } from "kern-orm"
import type { TestHelpers } from "kern-orm/testing"
import { createTestHelpers } from "kern-orm/testing"
import postgres from "postgres"

const { DATABASE_URL } = process.env

/** Database of a `describePostgres` block with its test helpers. */
export interface PostgresTestContext extends TestHelpers {
  /** Database created with `test: true`, closed after the block. */
  readonly database: Database
  /** Executes a statement without parameters, such as DDL in the seed of a test fixture. */
  runStatement(text: string): Promise<void>
}

/**
 * Declares a `describe` block of tests that run in PostgreSQL, skipped when `DATABASE_URL` is not set.
 *
 * `body` registers the tests, which use the database of the block through `context`.
 */
export function describePostgres(name: string, body: (context: PostgresTestContext) => void): void {
  describe.skipIf(!DATABASE_URL)(name, () => {
    const database = createDatabase({
      driver: postgresJsDriver(postgres(DATABASE_URL!)),
      test: true,
    })
    afterAll(() => database.close())
    body({
      ...createTestHelpers(database, { before: beforeAll, after: afterAll }),
      database,
      async runStatement(text) {
        await database.execute(createStatement(text))
      },
    })
  })
}
