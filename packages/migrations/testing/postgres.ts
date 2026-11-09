// PostgreSQL of the tests of the migrator at `DATABASE_URL`, such as from `.env.test.local`; the tests that need it are skipped without it.
import { afterAll, beforeAll, describe } from "bun:test"

import { postgresJsDriver } from "@kern-orm/postgres-js"
import type { Connection, Database, Driver } from "kern-orm"
import { createDatabase } from "kern-orm"
import type { TestHelpers } from "kern-orm/testing"
import { createTestHelpers } from "kern-orm/testing"
import postgres from "postgres"

const { DATABASE_URL } = process.env

/** Database of a block of tests with what it sent to PostgreSQL and received. */
export interface PostgresContext {
  /** Database of the block, closed after it. */
  readonly database: Database
  /** Runs `callback` and returns the texts of the statements and scripts that the database executed meanwhile, in order. */
  recordStatements(callback: () => Promise<unknown>): Promise<string[]>
  /** Messages of the notices that PostgreSQL has sent to the database of the block, such as of `CREATE SCHEMA IF NOT EXISTS` of an existing schema. */
  readonly notices: string[]
}

/** Database of a `describePostgres` block, created with `test: true`, with its test helpers. */
export interface PostgresTestContext extends PostgresContext, TestHelpers {}

/**
 * Declares a `describe` block of tests that run in PostgreSQL, skipped when `DATABASE_URL` is not set.
 *
 * `body` registers the tests, which use the database of the block through `context`.
 */
export function describePostgres(name: string, body: (context: PostgresTestContext) => void): void {
  describe.skipIf(!DATABASE_URL)(name, () => {
    const context = connect(true)
    body({
      ...context,
      ...createTestHelpers(context.database, { before: beforeAll, after: afterAll }),
    })
  })
}

/**
 * Declares a `describe` block of tests that run in PostgreSQL on a database created without `test: true`, such as tests of concurrent transactions, skipped when `DATABASE_URL` is not set.
 *
 * A test drops the PostgreSQL schemas that its transactions commit.
 */
export function describePooledPostgres(
  name: string,
  body: (context: PostgresContext) => void,
): void {
  describe.skipIf(!DATABASE_URL)(name, () => {
    body(connect(false))
  })
}

/** Creates a database at `DATABASE_URL`, closed after the enclosing block, that records its statements and notices. */
function connect(test: boolean): PostgresContext {
  const notices: string[] = []
  let statements: string[] | undefined
  const record = (text: string) => statements?.push(text)
  const driver = recordStatements(
    postgresJsDriver(
      postgres(DATABASE_URL!, {
        onnotice: notice => notices.push(String(notice.message)),
      }),
    ),
    record,
  )
  const database = createDatabase({ driver, test })
  afterAll(() => database.close())
  return {
    database,
    notices,
    async recordStatements(callback) {
      const recorded: string[] = []
      statements = recorded
      try {
        await callback()
      } finally {
        statements = undefined
      }
      return recorded
    },
  }
}

/** Wraps `driver` to pass the text of every statement and script it executes, on the pool or on a connection, to `record`. */
function recordStatements(driver: Driver, record: (text: string) => void): Driver {
  return {
    closesReservedConnections: driver.closesReservedConnections,
    execute(statement) {
      record(statement.text)
      return driver.execute(statement)
    },
    executeScript(text) {
      record(text)
      return driver.executeScript(text)
    },
    async acquire() {
      const connection = await driver.acquire()
      const recorded: Connection = {
        execute(statement) {
          record(statement.text)
          return connection.execute(statement)
        },
        executeScript(text) {
          record(text)
          return connection.executeScript(text)
        },
        release: failure => connection.release(failure),
      }
      return recorded
    },
    close: () => driver.close(),
  }
}
