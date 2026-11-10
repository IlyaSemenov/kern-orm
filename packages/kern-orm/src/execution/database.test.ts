import { describe, expect, it } from "bun:test"

import { postgresJsDriver } from "@kern-orm/postgres-js"
import postgres from "postgres"

import { describePooledPostgres, describePostgres } from "../../testing/postgres"
import { createRecordingDriver } from "../../testing/recording-driver"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { Database, IsolationLevel } from "./database"
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

  describePooledPostgres("in PostgreSQL without test transactions", ({ database }) => {
    /** Creates a key that no other test locks, since tests of other files may run at once. */
    const createKey = () => `kern_lock_test_${crypto.randomUUID()}`

    /** Counts the backends that hold the lock of `key`; PostgreSQL shows a lock that a backend took several times once. */
    const countHolders = async (key: string) =>
      await database.query`
        SELECT count(*)::integer FROM pg_locks
        WHERE locktype = 'advisory' AND granted
          AND (classid::bigint << 32) + objid::bigint = hashtextextended(${key}, 0)
      `.get(t.integer)

    /** Runs `take` in `start`, such as in a session, holds what it takes until `check` ends, and returns what `take` gives. */
    async function whileHeld<T>(
      start: (callback: () => Promise<void>) => Promise<unknown>,
      take: () => Promise<T>,
      check: () => Promise<void>,
    ): Promise<T> {
      const taken = Promise.withResolvers<T>()
      const ended = Promise.withResolvers<void>()
      const level = start(async () => {
        taken.resolve(await take())
        await ended.promise
      })
      try {
        // It rejects the test if the level fails before it takes the lock.
        const result = await Promise.race([taken.promise, level.then(() => taken.promise)])
        await check()
        return result
      } finally {
        ended.resolve()
        await level
      }
    }

    it("holds a lock of a session until the session ends, takes it once for repeated and concurrent calls, and releases it once", async () => {
      const key = createKey()

      const taken = await whileHeld(
        callback => database.session(callback),
        async () => [
          ...(await Promise.all([database.tryLock(key), database.tryLock(key)])),
          await database.tryLock(key),
        ],
        async () => {
          expect(await database.transaction(() => database.tryLock(key))).toBe(false)
          expect(await database.session(() => database.tryLock(key))).toBe(false)
          expect(await countHolders(key)).toBe(1)
        },
      )

      expect(taken).toEqual([true, true, true])
      expect(await countHolders(key)).toBe(0)
      expect(await database.transaction(() => database.tryLock(key))).toBe(true)
    })

    it("holds a lock of a transaction until the transaction ends", async () => {
      const key = createKey()

      const taken = await whileHeld(
        callback => database.transaction(callback),
        () => database.tryLock(key),
        async () => {
          expect(await database.session(() => database.tryLock(key))).toBe(false)
          expect(await countHolders(key)).toBe(1)
        },
      )

      expect(taken).toBe(true)
      expect(await countHolders(key)).toBe(0)
    })

    it("releases more locks of a session than a result has columns, and returns its connection to the pool without them", async () => {
      const reported: unknown[] = []
      await using single = createDatabase({
        driver: postgresJsDriver(postgres(process.env.DATABASE_URL!, { max: 1 })),
        onReleaseError: error => reported.push(error),
      })
      const readBackend = async () => await single.query`SELECT pg_backend_pid()`.get(t.integer)
      const countOwnLocks = async () =>
        await single.query`
          SELECT count(*)::integer FROM pg_locks
          WHERE locktype = 'advisory' AND pid = pg_backend_pid()
        `.get(t.integer)
      // PostgreSQL limits the columns of a result to 1664.
      const keys = Array.from({ length: 1665 }, createKey)
      const backend = await readBackend()

      const inside = await single.session(async () => ({
        taken: (await Promise.all(keys.map(key => single.tryLock(key)))).every(Boolean),
        locks: await countOwnLocks(),
      }))

      expect(inside).toEqual({ taken: true, locks: 1665 })
      expect(await readBackend()).toBe(backend)
      expect(await countOwnLocks()).toBe(0)
      expect(reported).toEqual([])
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

describePooledPostgres("isolation levels in PostgreSQL", ({ database }) => {
  const getIsolation = async () =>
    await database.query`SELECT current_setting('transaction_isolation')`.get(t.text)

  it.each(["read committed", "repeatable read", "serializable"] as const)(
    "runs a transaction and its nested transactions at isolation level %s",
    async isolation => {
      const levels = await database.transaction(
        async () => ({
          transaction: await getIsolation(),
          inherited: await database.transaction(getIsolation),
          given: await database.transaction(getIsolation, { isolation }),
        }),
        { isolation },
      )

      expect(levels).toEqual({ transaction: isolation, inherited: isolation, given: isolation })
    },
  )

  it("rejects a nested transaction at another isolation level and continues the transaction", async () => {
    const isolation = await database.transaction(
      async () => {
        await expect(
          database.transaction(getIsolation, { isolation: "serializable" }),
        ).rejects.toThrow("its transaction runs at repeatable read")
        return await getIsolation()
      },
      { isolation: "repeatable read" },
    )

    expect(isolation).toBe("repeatable read")
  })

  it("starts a nested transaction at the isolation level that a transaction without one runs at", async () => {
    const levels = await database.transaction(async () => {
      const transaction = (await getIsolation()) as IsolationLevel
      return {
        transaction,
        nested: await database.transaction(getIsolation, { isolation: transaction }),
      }
    })

    expect(levels.nested).toBe(levels.transaction)
  })

  // The snapshot of a transaction at repeatable read or serializable comes from its first statement, which is that of its settings.
  it.each([
    { isolation: "read committed", count: 1 },
    { isolation: "repeatable read", count: 0 },
  ] as const)(
    "counts at $isolation with a search path a row that another connection commits once the callback starts",
    async ({ isolation, count }) => {
      await database.script("CREATE TABLE public.kern_snapshot_test (id integer)")
      try {
        const entered = Promise.withResolvers<void>()
        const committed = Promise.withResolvers<void>()
        const counted = database.transaction(
          async () => {
            entered.resolve()
            await committed.promise
            return await database.query`SELECT count(*)::integer FROM kern_snapshot_test`.get(
              t.integer,
            )
          },
          { isolation, searchPath: ["public"] },
        )
        try {
          await Promise.race([entered.promise, counted])
          // The callback has started, so the settings have completed; this statement runs on the pool.
          await database.script("INSERT INTO public.kern_snapshot_test VALUES (1)")
        } finally {
          // The transaction ends before the table is dropped, also when the insert fails.
          committed.resolve()
          await Promise.allSettled([counted])
        }

        expect(await counted).toBe(count)
      } finally {
        await database.script("DROP TABLE public.kern_snapshot_test")
      }
    },
  )
})

describePooledPostgres("sessions in PostgreSQL", ({ database }) => {
  /** Creates a database of one pooled connection, so that a statement after a session runs on the connection that the session released. */
  const createSingle = (onReleaseError?: (error: unknown) => void) =>
    createDatabase({
      driver: postgresJsDriver(postgres(process.env.DATABASE_URL!, { max: 1 })),
      onReleaseError,
    })

  const readConnection = async (database: Database) =>
    await database.query`SELECT pg_backend_pid() AS pid, current_setting('search_path') AS path`
      .take()
      .select({ pid: t.integer, path: t.text })

  it("sets the search path of the statements and transactions of a session, and restores it before the connection returns to the pool", async () => {
    await using single = createSingle()
    const before = await readConnection(single)

    const inside = await single.session(
      async () => ({
        session: await readConnection(single),
        transaction: await single.transaction(() => readConnection(single)),
      }),
      { searchPath: ["kern_session_test", "public"] },
    )

    expect(inside).toEqual({
      session: { pid: before.pid, path: '"kern_session_test", "public"' },
      transaction: { pid: before.pid, path: '"kern_session_test", "public"' },
    })
    expect(await readConnection(single)).toEqual(before)
  })

  it("runs a statement that PostgreSQL rejects in a transaction block, in the schema of the search path", async () => {
    const schemaName = `kern_session_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`
    await database.script(`
      CREATE SCHEMA ${schemaName};
      CREATE TABLE ${schemaName}.job (id integer);
    `)
    try {
      expect(database.isInTransactionBlock()).toBe(false)
      await database.session(
        async () => {
          expect(database.isInTransactionBlock()).toBe(false)
          const inTransaction = database.transaction(async () => {
            expect(database.isInTransactionBlock()).toBe(true)
            await database.script("CREATE INDEX CONCURRENTLY job_id_idx ON job (id)")
          })
          await expect(inTransaction).rejects.toThrow("cannot run inside a transaction block")
          await database.script("CREATE INDEX CONCURRENTLY job_id_idx ON job (id)")
        },
        { searchPath: [schemaName] },
      )

      const indexes = await database.query`
        SELECT indexname FROM pg_indexes WHERE schemaname = ${schemaName}
      `.pluck(t.text)
      expect(indexes).toEqual(["job_id_idx"])
    } finally {
      // Dropping the table first keeps PostgreSQL from sending a notice of what the schema drops with it.
      await database.script(`
        DROP TABLE ${schemaName}.job;
        DROP SCHEMA ${schemaName};
      `)
    }
  })

  it("rejects the later statements of a session whose connection is lost, and keeps the pool usable", async () => {
    const reported: unknown[] = []
    await using single = createSingle(error => reported.push(error))

    const session = single.session(
      async () => {
        const terminated = single.script("SELECT pg_terminate_backend(pg_backend_pid())")
        await expect(terminated).rejects.toBeInstanceOf(ConnectionError)
        await single.query`SELECT 1`
      },
      { searchPath: ["kern_session_test"] },
    )

    await expect(session).rejects.toThrow("the connection of the session failed")
    expect((await readConnection(single)).path).not.toContain("kern_session_test")
    expect(reported).toEqual([])
  })

  it("closes a connection whose search path fails to restore instead of returning it to the pool", async () => {
    const reported: unknown[] = []
    await using single = createSingle(error => reported.push(error))
    const before = await readConnection(single)

    // A script must not start a transaction; this one leaves a failed one, which rejects the statement that restores the search path.
    const session = single.session(() => single.script("BEGIN; SELECT 1 / 0"), {
      searchPath: ["kern_session_test"],
    })

    await expect(session).rejects.toThrow("division by zero")
    const after = await readConnection(single)
    expect(after.pid).not.toBe(before.pid)
    expect(after.path).toBe(before.path)
    expect(reported).toHaveLength(1)
    expect(reported[0]).toMatchObject({ message: "Restoring the settings of a session failed" })
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
