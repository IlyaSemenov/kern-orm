// PostgreSQL of the tests at `DATABASE_URL`, such as from `.env.test.local`, with a `Database` of kern-db; the tests that need it are skipped without it.
import { afterAll, beforeAll, describe } from "bun:test"

import type { Database } from "kern-db"
import { createDatabase } from "kern-db"
import { postgresJsDriver } from "kern-db/postgres-js"
import type { TestHelpers } from "kern-db/testing"
import { createTestHelpers } from "kern-db/testing"
import postgres from "postgres"

const { DATABASE_URL } = process.env

/** Database of a `describePostgres` block with its test helpers. */
export interface PostgresTestContext extends TestHelpers {
  /** Database created with `test: true`, closed after the block. */
  readonly database: Database
}

/** Database of a `describePooledPostgres` block. */
export interface PooledPostgresContext {
  /** Database created without `test: true`, closed after the block. */
  readonly database: Database
}

/**
 * Declares a `describe` block of tests that run in PostgreSQL on a database created without `test: true`, such as tests of what concurrent transactions see, skipped when `DATABASE_URL` is not set.
 *
 * A test drops what its transactions commit.
 */
export function describePooledPostgres(
  name: string,
  body: (context: PooledPostgresContext) => void,
): void {
  describe.skipIf(!DATABASE_URL)(name, () => {
    const database = createDatabase({ driver: postgresJsDriver(postgres(DATABASE_URL!)) })
    afterAll(() => database.close())
    body({ database })
  })
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
    })
  })
}
