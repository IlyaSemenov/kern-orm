// PostgreSQL of the tests of the migrator at `DATABASE_URL`, such as from `.env.test.local`; the tests that need it are skipped without it.
import { afterAll, beforeAll, describe } from "bun:test"

import type { Connection, Database, Driver, DriverResult, SqlStatement } from "kern-orm"
import { createDatabase } from "kern-orm"
import { postgresJsDriver } from "kern-orm/db/postgres-js"
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
  /** Counts the attempts of the database to take an advisory lock in a session, such as of `pollLock`, that found it held by another session. */
  countRefusedLocks(): number
  /** Makes the next statement or script of the database whose text `matches` reject with `error` without running it, such as to fail a call between two statements. */
  failStatement(matches: (text: string) => boolean, error: Error): void
}

/** Database of a `describePostgres` block, created with `test: true`, with its test helpers. */
export interface PostgresTestContext extends PostgresContext, TestHelpers {}

/** Database of a `describePooledPostgres` block, created without `test: true`. */
export interface PooledPostgresContext extends PostgresContext {
  /** Creates another database at `DATABASE_URL`, closed after the block, such as of another process that migrates at once; call it in the body of the block. */
  connect(): PostgresContext
}

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
  body: (context: PooledPostgresContext) => void,
): void {
  describe.skipIf(!DATABASE_URL)(name, () => {
    body({ ...connect(false), connect: () => connect(false) })
  })
}

/** Creates a database at `DATABASE_URL`, closed after the enclosing block, that records its statements and notices. */
function connect(test: boolean): PostgresContext {
  const notices: string[] = []
  let statements: string[] | undefined
  let refusedLocks = 0
  const failures: { matches: (text: string) => boolean; error: Error }[] = []
  const driver = interceptStatements(
    postgresJsDriver(
      postgres(DATABASE_URL!, {
        onnotice: notice => notices.push(String(notice.message)),
      }),
    ),
    {
      before(text) {
        statements?.push(text)
        const index = failures.findIndex(failure => failure.matches(text))
        if (index !== -1) {
          const { error } = failures[index]!
          failures.splice(index, 1)
          throw error
        }
      },
      after(text, result) {
        if (text.includes("pg_try_advisory_lock(") && result.rows[0]?.[0] === "f") {
          refusedLocks++
        }
      },
    },
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
    countRefusedLocks: () => refusedLocks,
    failStatement(matches, error) {
      failures.push({ matches, error })
    },
  }
}

/** Callbacks of `interceptStatements`. */
interface StatementInterceptor {
  /** Receives the text of a statement or a script before it runs; it can throw to reject it without running it. */
  before(text: string): void
  /** Receives the text and the result of a statement after it succeeds. */
  after(text: string, result: DriverResult): void
}

/** Wraps `driver` to pass every statement and script it executes, on the pool or on a connection, to `interceptor`. */
function interceptStatements(driver: Driver, interceptor: StatementInterceptor): Driver {
  const execute = async (target: Pick<Driver, "execute">, statement: SqlStatement) => {
    interceptor.before(statement.text)
    const result = await target.execute(statement)
    interceptor.after(statement.text, result)
    return result
  }
  const executeScript = async (target: Pick<Driver, "executeScript">, text: string) => {
    interceptor.before(text)
    await target.executeScript(text)
  }
  return {
    execute: statement => execute(driver, statement),
    executeScript: text => executeScript(driver, text),
    async acquire() {
      const connection = await driver.acquire()
      const intercepted: Connection = {
        execute: statement => execute(connection, statement),
        executeScript: text => executeScript(connection, text),
        release: () => connection.release(),
      }
      return intercepted
    },
    close: () => driver.close(),
  }
}
