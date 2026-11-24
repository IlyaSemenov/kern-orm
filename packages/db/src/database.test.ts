import { describe, expect, it } from "bun:test"

import { getRejection } from "@kern-orm/test-harness/errors"
import { describePooledPostgres, describePostgres } from "@kern-orm/test-harness/postgres"
import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"
import postgres from "postgres"

import type { Database, IsolationLevel } from "./database"
import { createDatabase, isDatabase } from "./database"
import type { Connection, Driver, SqlStatement } from "./driver"
import { createStatement } from "./driver"
import { ConnectionError } from "./driver-error"
import { postgresJsDriver } from "./drivers/postgres-js"
import { identifier, joinSql, param, sql } from "./sql/fragment"
import { createTestHelpers, openTestTransaction } from "./test-helpers"
import { TransactionConnectionError } from "./transaction/connection-loss"
import * as t from "./types"

/**
 * Runs `take` in `start`, such as in a session, holds what it takes until `check` ends, and returns what `take` gives.
 *
 * With `limit`, it holds it for at most `limit` milliseconds after `take` resolves, so that a check that waits for it ends.
 */
async function whileHeld<T>(
  start: (callback: () => Promise<void>) => Promise<unknown>,
  take: () => Promise<T>,
  check: () => Promise<void>,
  limit?: number,
): Promise<T> {
  const taken = Promise.withResolvers<T>()
  const ended = Promise.withResolvers<void>()
  let timer: ReturnType<typeof setTimeout> | undefined
  const level = start(async () => {
    taken.resolve(await take())
    if (limit !== undefined) {
      timer = setTimeout(() => ended.resolve(), limit)
    }
    await ended.promise
  })
  try {
    // It rejects the test if the level fails before it takes the lock.
    const result = await Promise.race([taken.promise, level.then(() => taken.promise)])
    await check()
    return result
  } finally {
    clearTimeout(timer)
    ended.resolve()
    await level
  }
}

/** Longest time in milliseconds that a test holds a lock while it checks that another statement times out. */
const lockWaitLimit = 2000

describe("isDatabase", () => {
  it("recognizes a database of createDatabase, also of another copy of kern-db by its brand", () => {
    const { driver } = createRecordingDriver()
    const database = createDatabase({ driver })

    expect(isDatabase(database)).toBe(true)
    expect(isDatabase({ [Symbol.for("kern-db.Database")]: true })).toBe(true)
  })

  it("rejects a spread copy of a database", () => {
    const { driver } = createRecordingDriver()
    const database = createDatabase({ driver })

    expect(isDatabase({ ...database })).toBe(false)
  })

  it("rejects another value, such as a driver", () => {
    const { driver } = createRecordingDriver()

    expect(isDatabase(driver)).toBe(false)
    expect(isDatabase(null)).toBe(false)
    expect(isDatabase(undefined)).toBe(false)
  })
})

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

it("passes the statement of execute to the driver as it is, on the pool, in a transaction, and in a test transaction", async () => {
  // A statement with a field of its own, which a query builder can pass to its driver.
  const statement = { text: "SELECT 1", parameters: [], own: true }
  const received: SqlStatement[] = []
  const createDriver = (): Driver => {
    const { driver } = createRecordingDriver()
    return {
      ...driver,
      execute(executed) {
        received.push(executed)
        return driver.execute(executed)
      },
      async acquire() {
        const connection = await driver.acquire()
        return {
          ...connection,
          execute(executed) {
            received.push(executed)
            return connection.execute(executed)
          },
        }
      },
    }
  }
  const database = createDatabase({ driver: createDriver() })
  const testDatabase = createDatabase({ driver: createDriver(), test: true })
  const { testTransaction } = createTestHelpers(testDatabase, { before() {}, after() {} })

  await database.execute(statement)
  await database.transaction(() => database.execute(statement))
  await testTransaction(() => testDatabase.execute(statement))

  expect(received.filter(executed => executed === statement)).toHaveLength(3)
})

it("executes a script of its text or of a template, which interpolates fragments without parameters, in the ambient transaction", async () => {
  const { driver, scripts } = createRecordingDriver()
  const database = createDatabase({ driver })

  await database.script("SET lock_timeout = '1s'; SELECT 1")
  await database.transaction(
    () =>
      database.script`CREATE INDEX ON ${identifier("app", "form")} (${joinSql([sql`lower(name)`, identifier("id")])})`,
  )

  expect(scripts).toEqual([
    { connection: "pool", script: "SET lock_timeout = '1s'; SELECT 1" },
    { connection: 1, script: 'CREATE INDEX ON "app"."form" (lower(name), "id")' },
  ])
})

it("rejects a value in the template of a script, also in a fragment that it interpolates, before the script runs", async () => {
  const { driver, scripts } = createRecordingDriver()
  const database = createDatabase({ driver })
  const message =
    "A script has no parameters, so its template takes no values, also in the fragments that it interpolates"

  await expect(database.script`SELECT ${1}`).rejects.toThrow(message)
  await expect(database.script`SELECT ${sql`upper(${"x"})`}`).rejects.toThrow(message)
  await expect(database.script`SELECT ${param(t.text, "x")}`).rejects.toThrow(message)
  await expect(database.script`SELECT ${joinSql([sql`1`, 2])}`).rejects.toThrow(message)
  expect(scripts).toEqual([])
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

    it("holds a lock of an open session between the callbacks of run until the session is closed", async () => {
      const key = createKey()

      {
        await using session = await database.openSession()
        expect(await session.run(() => database.tryLock(key))).toBe(true)
        expect(await database.session(() => database.tryLock(key))).toBe(false)
        expect(await session.run(() => countHolders(key))).toBe(1)
      }

      expect(await countHolders(key)).toBe(0)
      expect(await database.session(() => database.tryLock(key))).toBe(true)
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

    it("polls in a session for a lock that another session holds until that session ends", async () => {
      const key = createKey()
      const refused = Promise.withResolvers<void>()
      const driver = postgresJsDriver(postgres(process.env.DATABASE_URL!, { max: 1 }))
      // Each attempt of the poll that finds the lock held resolves `refused`.
      await using polling = createDatabase({
        driver: {
          execute: statement => driver.execute(statement),
          executeScript: text => driver.executeScript(text),
          async acquire() {
            const connection = await driver.acquire()
            return {
              async execute(statement) {
                const result = await connection.execute(statement)
                if (statement.text.includes("pg_try_advisory_lock") && result.rows[0]![0] === "f") {
                  refused.resolve()
                }
                return result
              },
              executeScript: text => connection.executeScript(text),
              release: () => connection.release(),
            }
          },
          close: () => driver.close(),
        },
      })

      let polled: Promise<number> | undefined
      await whileHeld(
        callback => database.session(callback),
        () => database.tryLock(key),
        async () => {
          polled = polling.session(async () => {
            await polling.pollLock(key)
            return await countHolders(key)
          })
          // It rejects the test if the poll ends before an attempt finds the lock held.
          await Promise.race([
            refused.promise,
            polled.then(() => {
              throw new Error("The poll took a lock that another session held")
            }),
          ])
        },
      )

      expect(await polled!).toBe(1)
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

describePostgres("lock timeout in PostgreSQL", ({ database, testTransaction }) => {
  const getLockTimeout = async () =>
    await database.query`SELECT current_setting('lock_timeout')`.get(t.text)

  /** Runs `callback` while an open test transaction on a connection of its own holds the advisory lock of a new key, which it receives, for at most `lockWaitLimit`. */
  async function holdLock<T>(callback: (key: string) => Promise<T>): Promise<T> {
    const key = `kern_lock_timeout_test_${crypto.randomUUID()}`
    const holder = await openTestTransaction(database)
    let guard: ReturnType<typeof setTimeout> | undefined
    try {
      // A nested transaction keeps its lock after its release, until the test transaction ends.
      await holder.run(() => database.transaction(() => database.lock(key)))
      // A lock wait without a timeout ends once the holder closes, and the test transaction that waits for it ends only then; the closing in `finally` returns this closing, which passes its failure to the test.
      guard = setTimeout(() => holder.close().catch(() => {}), lockWaitLimit)
      return await callback(key)
    } finally {
      clearTimeout(guard)
      await holder.close()
    }
  }

  it("bounds the lock waits of the callback of a transaction that runs in a test transaction", async () => {
    const rejection = await holdLock(key =>
      testTransaction(() =>
        getRejection(database.transaction(() => database.lock(key), { lockTimeout: 50 })),
      ),
    )

    expect(rejection).toMatchObject({ code: "55P03" })
  })

  it("bounds the lock waits of nested transactions and restores the enclosing lock timeout when each is released or rolls back", async () => {
    const timeouts = await holdLock(key =>
      testTransaction(async () => {
        const initial = await getLockTimeout()
        const nested = await database.transaction(
          async () => ({
            inherited: await getRejection(database.transaction(() => database.lock(key))),
            own: await database.transaction(getLockTimeout, { lockTimeout: 0 }),
            released: await getLockTimeout(),
            ownWait: await getRejection(
              database.transaction(() => database.lock(key), { lockTimeout: 30 }),
            ),
            rolledBack: await getLockTimeout(),
          }),
          { lockTimeout: 50 },
        )
        return { initial, nested, after: await getLockTimeout() }
      }),
    )

    expect(timeouts).toEqual({
      initial: timeouts.initial,
      nested: {
        inherited: expect.objectContaining({ code: "55P03" }),
        own: "0",
        released: "50ms",
        ownWait: expect.objectContaining({ code: "55P03" }),
        rolledBack: "50ms",
      },
      after: timeouts.initial,
    })
  })
})

describePooledPostgres(
  "lock timeout of transactions and sessions in PostgreSQL",
  ({ database }) => {
    /** Holds the advisory lock of a new key in a transaction while `check` runs with the key, for at most `lockWaitLimit`. */
    async function whileLocked(check: (key: string) => Promise<void>): Promise<void> {
      const key = `kern_lock_timeout_test_${crypto.randomUUID()}`
      await whileHeld(
        callback => database.transaction(callback),
        () => database.lock(key),
        () => check(key),
        lockWaitLimit,
      )
    }

    it("bounds the lock waits of a transaction", async () => {
      await whileLocked(async key => {
        const rejection = await getRejection(
          database.transaction(() => database.lock(key), { lockTimeout: 50 }),
        )
        expect(rejection).toMatchObject({ code: "55P03" })
      })
    })

    it("bounds the lock waits of a session", async () => {
      await whileLocked(async key => {
        const rejection = await getRejection(
          database.session(
            () => database.query`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
            { lockTimeout: 50 },
          ),
        )
        expect(rejection).toMatchObject({ code: "55P03" })
      })
    })
  },
)

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

describePooledPostgres("external transactions in PostgreSQL", ({ database }) => {
  /**
   * Runs `callback` with a connection in a transaction that the test owns and rolls back, as another library holds its transaction.
   *
   * It then runs `afterRollback` on the connection, which still has what a transaction that committed by mistake left in its session, such as a temporary table.
   */
  async function withOwnedTransaction<T>(
    callback: (connection: Connection) => Promise<T>,
    afterRollback?: (connection: Connection) => Promise<void>,
  ): Promise<T> {
    const driver = postgresJsDriver(postgres(process.env.DATABASE_URL!, { max: 1 }))
    try {
      const connection = await driver.acquire()
      try {
        let result
        try {
          await connection.execute(createStatement("BEGIN"))
          result = await callback(connection)
        } finally {
          await connection.execute(createStatement("ROLLBACK"))
        }
        await afterRollback?.(connection)
        return result
      } finally {
        await connection.release()
      }
    } finally {
      await driver.close()
    }
  }

  const readOwned = async (connection: Connection, text: string) =>
    (await connection.execute(createStatement(text))).rows.map(row => row[0])

  it("runs the queries of the callback in the transaction of the connection, which its owner rolls back", async () => {
    let remaining: unknown
    const seen = await withOwnedTransaction(
      async connection => {
        await connection.execute(createStatement("CREATE TEMP TABLE kern_external (id integer)"))
        const inside = await database.externalTransaction(connection, async () => {
          await database.query`INSERT INTO kern_external VALUES (1)`
          return {
            backend: await database.query`SELECT pg_backend_pid()::text`.get(t.text),
            rows: await database.query`SELECT id FROM kern_external`.pluck(t.integer),
          }
        })
        return {
          inside,
          backend: (await readOwned(connection, "SELECT pg_backend_pid()"))[0],
          rows: await readOwned(connection, "SELECT id FROM kern_external"),
        }
      },
      async connection => {
        remaining = await readOwned(connection, "SELECT to_regclass('pg_temp.kern_external')")
      },
    )

    expect(seen.inside).toEqual({ backend: seen.backend!, rows: [1] })
    expect(seen.rows).toEqual(["1"])
    expect(remaining).toEqual([null])
  })

  it("rolls back a failed nested transaction to its savepoint, restores the search path, and keeps the external transaction", async () => {
    const failure = new Error("failure")

    const seen = await withOwnedTransaction(async connection => {
      await connection.execute(createStatement("CREATE TEMP TABLE kern_external (id integer)"))
      const initial = (await readOwned(connection, "SELECT current_setting('search_path')"))[0]
      await database.externalTransaction(connection, async () => {
        await database.transaction(
          async () => {
            await database.query`INSERT INTO kern_external VALUES (1)`
          },
          { searchPath: ["pg_temp"] },
        )
        const failed = database.transaction(
          async () => {
            await database.query`INSERT INTO kern_external VALUES (2)`
            await database.query`SELECT 1 / 0`
          },
          { searchPath: ["pg_temp"] },
        )
        await expect(failed).rejects.toMatchObject({ code: "22012" })
        const thrown = database.transaction(async () => {
          await database.query`INSERT INTO kern_external VALUES (3)`
          throw failure
        })
        await expect(thrown).rejects.toBe(failure)
      })
      return {
        initial,
        path: (await readOwned(connection, "SELECT current_setting('search_path')"))[0],
        rows: await readOwned(connection, "SELECT id FROM kern_external"),
      }
    })

    expect(seen).toEqual({ initial: seen.initial, path: seen.initial, rows: ["1"] })
  })
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
