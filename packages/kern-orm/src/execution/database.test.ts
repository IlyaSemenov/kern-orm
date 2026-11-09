import { describe, expect, it } from "bun:test"

import { postgresJsDriver } from "@kern-orm/postgres-js"
import postgres from "postgres"

import { describePooledPostgres, describePostgres } from "../../testing/postgres"
import { createRecordingDriver } from "../../testing/recording-driver"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { createDatabase } from "./database"
import { createStatement } from "./driver"
import { ConnectionError } from "./driver-error"
import { TransactionConnectionError } from "./transaction/connection-loss"

it("closes the driver when disposed", async () => {
  const { driver } = createRecordingDriver()
  let closed = false
  driver.close = () => {
    closed = true
    return Promise.resolve()
  }

  {
    await using database = createDatabase({ driver })
    expect(database).toBeDefined()
  }

  expect(closed).toBe(true)
})

it("rejects queries, scripts, and transactions of a database created for tests outside a test transaction", async () => {
  const { driver, statements, scripts } = createRecordingDriver()
  const database = createDatabase({ driver, test: true })

  await expect(database.execute(createStatement("outside"))).rejects.toThrow(
    "Cannot execute a query outside a test transaction",
  )
  await expect(database.script("outside")).rejects.toThrow(
    "Cannot execute a script outside a test transaction",
  )
  await expect(database.transaction(() => Promise.resolve())).rejects.toThrow(
    "Cannot start a transaction outside a test transaction",
  )
  expect(statements).toEqual([])
  expect(scripts).toEqual([])
})

it("passes a failed release of the connection of a transaction to onReleaseError", async () => {
  const releaseError = new Error("release")
  const reported: unknown[] = []
  const { driver } = createRecordingDriver({
    release: () => Promise.reject(releaseError),
  })
  const database = createDatabase({ driver, onReleaseError: error => reported.push(error) })

  await expect(database.transaction(() => Promise.resolve("done"))).resolves.toBe("done")
  expect(reported).toEqual([releaseError])
})

it("executes a script without a Db, rejecting tables of a Db", async () => {
  const { driver, scripts } = createRecordingDriver()
  const database = createDatabase({ driver })
  const form = defineTable("form", {
    id: t.integer,
  })
  const db = database.bind(defineSchema({ form }))

  await database.script("SET lock_timeout = '1s'; SELECT 1")
  await database.script`SET lock_timeout = '2s'; SELECT 2`
  await expect(database.script`ANALYZE ${db.form}`).rejects.toThrow(
    'Table "form" interpolated into SQL is bound to another Db',
  )

  expect(scripts).toEqual([
    { connection: "pool", script: "SET lock_timeout = '1s'; SELECT 1" },
    { connection: "pool", script: "SET lock_timeout = '2s'; SELECT 2" },
  ])
})

describe("advisory locks", () => {
  it("rejects a lock outside a transaction, also in a test transaction, without a statement", async () => {
    const { driver, statements } = createRecordingDriver()
    const database = createDatabase({ driver, test: true })
    const message =
      "Cannot take an advisory lock outside a transaction, where it would end with its statement; a test transaction alone does not count"

    await expect(database.lock("import")).rejects.toThrow(message)
    await database.coordinator.testTransaction(async () => {
      await expect(database.lock("import")).rejects.toThrow(message)
    })

    expect(statements.map(({ text }) => text)).toEqual(["BEGIN", "ROLLBACK"])
  })

  describePostgres("in PostgreSQL", ({ database, testTransaction }) => {
    const countLocks = async (key: string) =>
      await database.query`
        SELECT count(*)::integer FROM pg_locks
        WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted
          AND (classid::bigint << 32) + objid::bigint = hashtextextended(${key}, 0)
      `.get(t.integer)

    it("keeps the locks of the transaction and of a released nested transaction, and releases those of a nested transaction that rolls back", async () => {
      const failure = new Error("failure")

      const counts = await testTransaction(() =>
        database.transaction(async () => {
          await database.lock("import")
          const released = database.transaction(async () => {
            await database.lock("export")
            throw failure
          })
          await expect(released).rejects.toBe(failure)
          await database.transaction(() => database.lock("report"))
          return {
            import: await countLocks("import"),
            export: await countLocks("export"),
            report: await countLocks("report"),
          }
        }),
      )

      expect(counts).toEqual({ import: 1, export: 0, report: 1 })
    })
  })
})

describePostgres("search path in PostgreSQL", ({ database, testTransaction }) => {
  const getSearchPath = async () =>
    await database.query`SELECT current_setting('search_path')`.get(t.text)

  // Orchid ORM ignored the settings of a transaction inside a test transaction: https://github.com/romeerez/orchid-orm/pull/806
  it("sets the search path of nested transactions and restores the enclosing one when each is released", async () => {
    const paths = await testTransaction(async () => {
      const initial = await getSearchPath()
      const nested = await database.transaction(
        async () => ({
          outer: await getSearchPath(),
          inner: await database.transaction(getSearchPath, { searchPath: ["Tenant"] }),
          after: await getSearchPath(),
        }),
        { searchPath: ["tenant_1", "extensions"] },
      )
      return { initial, nested, after: await getSearchPath() }
    })

    expect(paths).toEqual({
      initial: paths.initial,
      nested: {
        outer: '"tenant_1", "extensions"',
        inner: '"Tenant"',
        after: '"tenant_1", "extensions"',
      },
      after: paths.initial,
    })
  })

  it("restores the search path of the enclosing transaction when a nested one rolls back", async () => {
    const failure = new Error("failure")

    const paths = await testTransaction(async () => {
      const initial = await getSearchPath()
      const nested = database.transaction(
        async () => {
          await getSearchPath()
          throw failure
        },
        { searchPath: ["tenant_1"] },
      )
      await expect(nested).rejects.toBe(failure)
      return { initial, after: await getSearchPath() }
    })

    expect(paths.after).toBe(paths.initial)
  })
})

describePooledPostgres("connection failures of transactions in PostgreSQL", ({ database }) => {
  /** Terminates the backend of the connection of the current transaction, which rejects the statement with ConnectionError. */
  const terminateBackend = async () => {
    await database.query`SELECT pg_terminate_backend(pg_backend_pid())`
  }

  const selectUsable = async () => await database.query`SELECT 'usable'`.get(t.text)

  it("rejects with phase begin when getting the connection fails", async () => {
    const url = new URL(process.env.DATABASE_URL!)
    url.pathname = "/kern_orm_missing_database"
    await using missing = createDatabase({ driver: postgresJsDriver(postgres(url.href)) })

    let called = false
    const rejection = await missing
      .transaction(async () => {
        called = true
      })
      .catch((error: unknown) => error)

    expect(rejection).toBeInstanceOf(TransactionConnectionError)
    expect(rejection).toMatchObject({ phase: "begin" })
    expect((rejection as Error).cause).toBeInstanceOf(ConnectionError)
    expect(called).toBe(false)
  })

  it("rejects with phase begin when BEGIN fails, and keeps the pool usable", async () => {
    const driver = postgresJsDriver(postgres(process.env.DATABASE_URL!, { max: 1 }))
    // Each connection of the transactions loses its backend before BEGIN.
    await using terminating = createDatabase({
      driver: {
        execute: statement => driver.execute(statement),
        executeScript: text => driver.executeScript(text),
        async acquire() {
          const connection = await driver.acquire()
          await connection
            .execute(createStatement("SELECT pg_terminate_backend(pg_backend_pid())"))
            .catch(() => {})
          return connection
        },
        close: () => driver.close(),
      },
    })

    let called = false
    const rejection = await terminating
      .transaction(async () => {
        called = true
      })
      .catch((error: unknown) => error)

    expect(rejection).toBeInstanceOf(TransactionConnectionError)
    expect(rejection).toMatchObject({ phase: "begin" })
    expect(called).toBe(false)
    expect(await terminating.query`SELECT 'usable'`.get(t.text)).toBe("usable")
  })

  it("rejects with phase transaction when the connection fails in the callback, also when the callback catches the failure, and keeps the pool usable", async () => {
    const rejected = await database.transaction(terminateBackend).catch((error: unknown) => error)
    const resolved = await database
      .transaction(async () => {
        await terminateBackend().catch(() => {})
        return "resolved"
      })
      .catch((error: unknown) => error)

    for (const rejection of [rejected, resolved]) {
      expect(rejection).toBeInstanceOf(TransactionConnectionError)
      expect(rejection).toMatchObject({ phase: "transaction" })
    }
    expect(await database.transaction(selectUsable)).toBe("usable")
  })

  it("rejects with phase commit when the connection fails during COMMIT, and keeps the pool usable", async () => {
    // The trigger runs at COMMIT and terminates its own backend, which drops the temporary objects with the session.
    const rejection = await database
      .transaction(() =>
        database.script(`
          CREATE TEMP TABLE kern_commit_test (id integer);
          CREATE FUNCTION pg_temp.kern_terminate_backend() RETURNS trigger LANGUAGE plpgsql
            AS $$ BEGIN PERFORM pg_terminate_backend(pg_backend_pid()); RETURN NULL; END $$;
          CREATE CONSTRAINT TRIGGER kern_terminate_backend AFTER INSERT ON kern_commit_test
            DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pg_temp.kern_terminate_backend();
          INSERT INTO kern_commit_test VALUES (1);
        `),
      )
      .catch((error: unknown) => error)

    expect(rejection).toBeInstanceOf(TransactionConnectionError)
    expect(rejection).toMatchObject({ phase: "commit" })
    expect((rejection as Error).cause).toBeInstanceOf(ConnectionError)
    expect(await database.transaction(selectUsable)).toBe("usable")
  })
})
