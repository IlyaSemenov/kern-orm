// PostgreSQL of the tests of the database layer at `DATABASE_URL`, such as from `.env.test.local`; the tests that need it are skipped without it.
import { afterAll, beforeAll, describe } from "bun:test"

import { postgresJsDriver } from "@kern-orm/postgres-js"
import type { Database, DatabaseOptions } from "kern-orm/db"
import { createDatabase } from "kern-orm/db"
import type { TestHelpers } from "kern-orm/testing"
import { createTestHelpers } from "kern-orm/testing"
import postgres from "postgres"

const { DATABASE_URL } = process.env

/** Database of a `describePostgres` block with its test helpers. */
export interface PostgresTestContext<D extends Database = Database> extends TestHelpers {
  /** Database created with `test: true`, closed after the block. */
  readonly database: D
}

/** Database of a `describePooledPostgres` block. */
export interface PooledPostgresContext<D extends Database = Database> {
  /** Database created without `test: true`, closed after the block. */
  readonly database: D
}

/** Functions that declare blocks of tests in PostgreSQL, each over a database that one function creates. */
export interface PostgresBlocks<D extends Database> {
  /**
   * Declares a `describe` block of tests that run in PostgreSQL on a database created without `test: true`, such as tests of what concurrent transactions see, skipped when `DATABASE_URL` is not set.
   *
   * A test drops what its transactions commit.
   */
  describePooledPostgres(name: string, body: (context: PooledPostgresContext<D>) => void): void
  /**
   * Declares a `describe` block of tests that run in PostgreSQL, skipped when `DATABASE_URL` is not set.
   *
   * `body` registers the tests, which use the database of the block through `context`.
   */
  describePostgres(name: string, body: (context: PostgresTestContext<D>) => void): void
}

/** Creates the functions that declare blocks of tests in PostgreSQL over a database of `create`, such as `createDatabase` of the ORM. */
export function definePostgresBlocks<D extends Database>(
  create: (options: DatabaseOptions) => D,
): PostgresBlocks<D> {
  return {
    describePooledPostgres(name, body) {
      describe.skipIf(!DATABASE_URL)(name, () => {
        const database = create({ driver: postgresJsDriver(postgres(DATABASE_URL!)) })
        afterAll(() => database.close())
        body({ database })
      })
    },
    describePostgres(name, body) {
      describe.skipIf(!DATABASE_URL)(name, () => {
        const database = create({
          driver: postgresJsDriver(postgres(DATABASE_URL!)),
          test: true,
        })
        afterAll(() => database.close())
        body({
          ...createTestHelpers(database, { before: beforeAll, after: afterAll }),
          database,
        })
      })
    },
  }
}

export const { describePooledPostgres, describePostgres } = definePostgresBlocks(createDatabase)
