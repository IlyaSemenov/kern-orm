import { afterAll, beforeAll, describe, expect, test } from "bun:test"

import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"
import type { Database } from "kern-db"
import { createDatabase, identifier } from "kern-db"
import { postgresJsDriver } from "kern-db/postgres-js"
import * as t from "kern-db/types"
import type { Adapter } from "orchid-orm"
import { orchidORM } from "orchid-orm/postgres-js"
import postgres from "postgres"

import { runInOrchidTransaction } from "./orchid-transaction"

const statementFailure =
  "runInOrchidTransaction(): a statement failed in the transaction or savepoint of Orchid ORM that runs the call, which can therefore only roll back, also after a nested transaction rolled the statement back"

describe("runInOrchidTransaction without a transaction client", () => {
  let database: Database
  beforeAll(() => {
    database = createDatabase({ driver: createRecordingDriver().driver })
  })
  afterAll(() => database.close())

  /** Returns an Orchid instance whose current adapter is `adapter`. */
  const toSource = (adapter: object) => ({ $getAdapter: () => adapter as Adapter })

  test("rejects outside a transaction of Orchid before the callback", async () => {
    let called = false
    const run = runInOrchidTransaction(
      toSource({ isInTransaction: () => false }),
      database,
      async () => {
        called = true
      },
    )

    await expect(run).rejects.toEqual(
      new TypeError(
        "runInOrchidTransaction() must run in a transaction of Orchid ORM, such as in the callback of $transaction or in a test transaction",
      ),
    )
    expect(called).toBe(false)
  })

  test("rejects outside a transaction of Orchid before the callback without a database", async () => {
    let called = false
    const run = runInOrchidTransaction(toSource({ isInTransaction: () => false }), async () => {
      called = true
    })

    await expect(run).rejects.toBeInstanceOf(TypeError)
    expect(called).toBe(false)
  })

  const isInTransaction = () => true
  test.each([
    ["a transaction adapter without a client", { isInTransaction }],
    ["a client of another driver", { isInTransaction, client: { query: () => Promise.resolve() } }],
    [
      "a test transaction over an adapter without a client",
      { isInTransaction, trx: {}, adapter: { isInTransaction } },
    ],
  ])("rejects for %s, naming the tested versions", async (_, adapter) => {
    await expect(
      runInOrchidTransaction(toSource(adapter), database, async () => {}),
    ).rejects.toEqual(
      new Error(
        "runInOrchidTransaction() did not recognize the postgres.js client in the transaction of Orchid ORM: it requires a native instance of Orchid ORM on postgres.js, not an instance of createOrchidInterop, whose transactions belong to kern-db, and was tested with Orchid ORM 1.78.61 (pqb 0.73.50) on postgres.js 4",
      ),
    )
  })
})

const { DATABASE_URL } = process.env

describe.skipIf(!DATABASE_URL)("runInOrchidTransaction with a commit of Orchid", () => {
  const orchid = orchidORM({ databaseURL: DATABASE_URL }, {})
  /** Database whose pool reads what the transactions of Orchid committed. */
  const database = createDatabase({ driver: postgresJsDriver(postgres(DATABASE_URL!)) })
  /** Table that outlives the transactions of the tests, so that the pool of the database reads what they committed. */
  const name = `kern_orchid_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`
  const table = identifier("public", name)
  beforeAll(() => database.script`CREATE TABLE ${table} (id integer)`)
  afterAll(async () => {
    await database.script`DROP TABLE IF EXISTS ${table}`
    await database.close()
    await orchid.$close()
  })

  /** Returns the committed ids from `from` to `to`, so that each test reads the rows of its own ids. */
  const readCommitted = (from: number, to: number) =>
    database.query`SELECT id FROM ${table} WHERE id BETWEEN ${from} AND ${to} ORDER BY id`.pluck(
      t.integer,
    )
  const insert = (id: number) => database.query`INSERT INTO ${table} VALUES (${id})`

  test("commits the statements of the callback with the transaction of Orchid", async () => {
    const result = await orchid.$transaction(async () => {
      await orchid.$getAdapter().query(`INSERT INTO public.${name} VALUES (1)`)
      return runInOrchidTransaction(orchid, database, async () => {
        await insert(2)
        const thrown = database.transaction(async () => {
          await insert(3)
          throw new Error("rollback")
        })
        await expect(thrown).rejects.toEqual(new Error("rollback"))
        return "result"
      })
    })

    expect(result).toBe("result")
    expect(await readCommitted(1, 3)).toEqual([1, 2])
  })

  test("tells the form by the number of arguments, also for a database that is callable", async () => {
    let called = false
    const callable = Object.assign(async () => {
      called = true
    }, database)

    const result = await orchid.$transaction(() =>
      runInOrchidTransaction(orchid, callable, async () => "callback"),
    )
    const missing = orchid.$transaction(() =>
      runInOrchidTransaction(orchid, callable, undefined as never),
    )

    expect(result).toBe("callback")
    await expect(missing).rejects.toBeInstanceOf(TypeError)
    expect(called).toBe(false)
  })

  test("commits the statements of the database of the callback form with the transaction of Orchid", async () => {
    let external: Database | undefined
    const result = await orchid.$transaction(() =>
      runInOrchidTransaction(orchid, async database => {
        external = database
        await database.query`INSERT INTO ${table} VALUES (${11})`
        const thrown = database.transaction(async () => {
          await database.query`INSERT INTO ${table} VALUES (${12})`
          throw new Error("rollback")
        })
        await expect(thrown).rejects.toEqual(new Error("rollback"))
        return "result"
      }),
    )

    expect(result).toBe("result")
    expect(await readCommitted(11, 12)).toEqual([11])
    await expect(external!.execute({ text: "SELECT 1", parameters: [] })).rejects.toEqual(
      new Error("Cannot execute a query: the database is closed"),
    )
  })

  test("rejects, and Orchid commits nothing, after a nested transaction rolled back a failed statement", async () => {
    const transaction = orchid.$transaction(() =>
      runInOrchidTransaction(orchid, database, async () => {
        await insert(4)
        const failed = database.transaction(async () => {
          await insert(5)
          await database.query`SELECT 1 / 0`
        })
        await expect(failed).rejects.toMatchObject({ code: "22012" })
        await insert(6)
      }),
    )

    await expect(transaction).rejects.toBeInstanceOf(Error)
    await expect(transaction).rejects.toMatchObject({
      message: statementFailure,
      cause: { code: "22012" },
    })
    expect(await readCommitted(4, 6)).toEqual([])
  })

  test("rejects after a statement that the callback did not await failed", async () => {
    const transaction = orchid.$transaction(() =>
      runInOrchidTransaction(orchid, database, async () => {
        void database.script`SELECT pg_sleep(0.1); SELECT 1 / 0`.catch(() => {})
      }),
    )

    await expect(transaction).rejects.toMatchObject({
      message: statementFailure,
      cause: { code: "22012" },
    })
  })

  test("rejects with the error of a callback that rejects after a statement failed", async () => {
    const failure = new Error("failure")
    const transaction = orchid.$transaction(() =>
      runInOrchidTransaction(orchid, database, async () => {
        await database
          .transaction(async () => {
            await database.query`SELECT 1 / 0`
          })
          .catch(() => {})
        throw failure
      }),
    )

    await expect(transaction).rejects.toBe(failure)
  })

  test("runs in the innermost savepoint of Orchid, and resolves after a failed statement of a savepoint that Orchid rolled back", async () => {
    await orchid.$transaction(async () => {
      await orchid
        .$transaction(async () => {
          await runInOrchidTransaction(orchid, database, async () => {
            await insert(7)
          })
          throw new Error("rollback")
        })
        .catch(() => {})
      await runInOrchidTransaction(orchid, database, async () => {
        await insert(8)
        const failed = orchid.$transaction(async () => {
          await insert(9)
          await database.query`SELECT 1 / 0`
        })
        await expect(failed).rejects.toMatchObject({ code: "22012" })
        await insert(10)
      })
    })

    expect(await readCommitted(7, 10)).toEqual([8, 10])
  })
})
