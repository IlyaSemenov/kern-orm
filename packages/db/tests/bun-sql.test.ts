import { afterAll, beforeAll, describe, expect, it } from "bun:test"

import { getRejection, getThrownError } from "@kern-orm/test-harness/errors"
import { ConnectionError, createStatement, QueryError } from "kern-db"
import { bunSqlDriver } from "kern-db/bun-sql"
import { describeDriverContract } from "kern-db/testing"

const { DATABASE_URL } = process.env

it.skipIf(!!process.versions.bun)(
  "reports the runtime requirement when called from Node.js",
  () => {
    // @ts-expect-error A JavaScript caller on Node.js has no Bun SQL pool.
    const error = getThrownError(() => bunSqlDriver())
    expect(error).toEqual(new TypeError("bunSqlDriver requires Bun 1.4.4 or newer"))
  },
)

it.skipIf(!process.versions.bun)("rejects a Bun SQL SQLite client", async () => {
  await using sqlite = new Bun.SQL("sqlite://:memory:", { prepare: false })
  expect(getThrownError(() => bunSqlDriver(sqlite))).toEqual(
    new TypeError("bunSqlDriver requires a Bun SQL PostgreSQL pool with prepare: false"),
  )
})

describe.skipIf(!process.versions.bun || !DATABASE_URL)("bunSqlDriver", () => {
  /** Creates a Bun SQL driver for the test database. */
  function createDriver({ max = 2 } = {}) {
    return bunSqlDriver(new Bun.SQL(DATABASE_URL!, { max, prepare: false }))
  }

  // Vitest collects skipped suites on Node.js, where constructing the contract fixture would access Bun.SQL.
  if (process.versions.bun) {
    describeDriverContract(
      {
        createDriver,
        createDriverWithFailingParsers: createDriver,
        createUnreachableDriver: () =>
          bunSqlDriver(new Bun.SQL("postgres://127.0.0.1:1/postgres", { prepare: false })),
      },
      { describe, it, before: beforeAll, after: afterAll },
    )
  }

  it("rejects a pool with prepared results or renamed result columns", async () => {
    await using prepared = new Bun.SQL(DATABASE_URL!)
    expect(() => bunSqlDriver(prepared)).toThrow("prepare: false")
    await using renamed = new Bun.SQL(DATABASE_URL!, { prepare: false, transform: Bun.SQL.camel })
    expect(() => bunSqlDriver(renamed)).toThrow("result column name transform")
  })

  it("rejects a reserved connection and the client of a transaction", async () => {
    await using pool = new Bun.SQL(DATABASE_URL!, { prepare: false })
    await using connection = await pool.reserve()
    expect(() => bunSqlDriver(connection)).toThrow("requires the client created by new SQL()")
    await pool.begin(async transaction => {
      expect(() => bunSqlDriver(transaction)).toThrow("requires the client created by new SQL()")
    })
  })

  it("preserves PostgreSQL text on repeated executions on the same connection", async () => {
    const driver = createDriver()
    const connection = await driver.acquire()
    try {
      const statement = createStatement(
        "SELECT NULL::jsonb, 'null'::jsonb, TIMESTAMP '2026-01-01 12:00:00.123456', '\\x00ff80'::bytea, $1::text",
        ["Привет 🌍"],
      )
      for (let run = 0; run < 2; run++) {
        const { rows } = await connection.execute(statement)
        expect(rows).toEqual([
          [null, "null", "2026-01-01 12:00:00.123456", "\\x00ff80", "Привет 🌍"],
        ])
      }
    } finally {
      await connection.release()
      await driver.close()
    }
  })

  it("accepts a committed script and rejects scripts that leave a chained transaction on a single-connection pool", async () => {
    const driver = createDriver({ max: 1 })
    try {
      await driver.executeScript("BEGIN; SELECT 1; COMMIT")
      for (const end of ["COMMIT AND CHAIN", "ROLLBACK AND CHAIN"]) {
        await expect(
          driver.executeScript("SELECT 1; START TRANSACTION; " + end),
        ).rejects.toBeInstanceOf(ConnectionError)
        await expect(driver.execute(createStatement("SAVEPOINT probe"))).rejects.toThrow(
          "transaction blocks",
        )
      }
    } finally {
      await driver.close()
    }
  })

  it("preserves the query error if release also fails and reports a release failure after success", async () => {
    const pool = new Bun.SQL(DATABASE_URL!, { max: 1, prepare: false })
    const failure = new Error("release failed")
    const reserve = pool.reserve.bind(pool)
    pool.reserve = async () => {
      const client = await reserve()
      const release = client.release.bind(client)
      client.release = async () => {
        await release()
        throw failure
      }
      return client
    }
    const driver = bunSqlDriver(pool)
    try {
      const rejected = await getRejection(driver.execute(createStatement("SELECT 1/0")))
      expect(rejected).toBeInstanceOf(QueryError)
      expect(rejected).toMatchObject({ code: "22012" })
      const cleanup = await getRejection(driver.execute(createStatement("SELECT 1")))
      expect(cleanup).toBeInstanceOf(ConnectionError)
      expect(cleanup).toMatchObject({ cause: failure, unsent: false })
    } finally {
      await driver.close()
    }
  })

  it("releases once after queued work and refuses new work from the call to release", async () => {
    const driver = createDriver({ max: 1 })
    const connection = await driver.acquire()
    try {
      const statement = createStatement("SELECT 42")
      const pending = connection.execute(statement)
      const releasing = connection.release()
      const again = connection.release()
      const refused = await getRejection(connection.execute(statement))
      expect(refused).toBeInstanceOf(ConnectionError)
      expect(refused).toMatchObject({ unsent: true })
      expect((await pending).rows).toEqual([["42"]])
      await Promise.all([releasing, again])
      await expect(connection.executeScript("SELECT 1")).rejects.toMatchObject({ unsent: true })
      expect((await driver.execute(statement)).rows).toEqual([["42"]])
    } finally {
      await connection.release()
      await driver.close()
    }
  })
})
