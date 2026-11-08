// PostgreSQL of the tests at `DATABASE_URL`, such as from `.env.test.local`; the tests that need it are skipped without it.
import { afterAll, beforeAll, describe } from "bun:test"

import { postgresJsDriver } from "@kern-orm/postgres-js"
import type { AnyDb, Database } from "kern-orm"
import { createDatabase, sql } from "kern-orm"
import type { TestHelpers } from "kern-orm/testing"
import { createTestHelpers } from "kern-orm/testing"
import * as t from "kern-orm/types"
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

/**
 * Runs `callback` while a transaction of `db` holds what `statement` takes, with what it gives, and commits it at the latest when `callback` ends.
 *
 * `callback` runs outside the transaction, on connections of its own, and can commit it earlier.
 */
export async function whileHolding<H>(
  db: AnyDb,
  statement: () => PromiseLike<H>,
  callback: (held: H, commit: () => Promise<void>) => Promise<void>,
): Promise<void> {
  const held = Promise.withResolvers<H>()
  const release = Promise.withResolvers<void>()
  const transaction = db.$transaction(async () => {
    held.resolve(await statement())
    await release.promise
  })
  const value = await Promise.race([held.promise, transaction.then(() => held.promise)])
  const commit = () => {
    release.resolve()
    return transaction
  }
  try {
    await callback(value, commit)
  } finally {
    await commit()
  }
}

/** Tells whether the backend `pid` starts waiting for a lock soon; `pg_blocking_pids` reads the locks themselves, whereas `pg_stat_activity` keeps its snapshot in a transaction. */
export async function startsWaiting(db: AnyDb, pid: number): Promise<boolean> {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const { waiting } = await db.$select({
      waiting: sql(t.boolean)`cardinality(pg_blocking_pids(${pid}::integer)) > 0`,
    })
    if (waiting) {
      return true
    }
  }
  return false
}

/** Starts a transaction of `db` that runs `statement` and returns once `statement` waits for a lock, with the backend of the transaction and the promise of what it gives after the wait. */
export async function startWaiting<T>(
  db: AnyDb,
  statement: () => PromiseLike<T>,
): Promise<{ pid: number; result: Promise<T> }> {
  const backend = Promise.withResolvers<number>()
  const result = db.$transaction(async () => {
    const { pid } = await db.$select({
      pid: sql(t.integer)`pg_backend_pid()`,
    })
    backend.resolve(pid)
    return await statement()
  })
  // It rejects the test if the transaction fails before it reads its backend.
  const pid = await Promise.race([backend.promise, result.then(() => backend.promise)])
  const waiting = await Promise.race([
    startsWaiting(db, pid),
    // It rejects the test if the transaction fails before the statement waits.
    result.then(() => false),
  ])
  if (!waiting) {
    throw new Error("The statement did not wait for a lock")
  }
  return { pid, result }
}
