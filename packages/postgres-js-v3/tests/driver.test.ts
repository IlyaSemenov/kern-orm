import { afterAll, beforeAll, describe, expect, it } from "bun:test"

import type { PostgresJsDriverOptions } from "@kern-orm/postgres-js-v3"
import { postgresJsDriver } from "@kern-orm/postgres-js-v3"
import type { Database, Driver } from "kern-orm"
import { createDatabase, createStatement } from "kern-orm"
import { describeDriverContract } from "kern-orm/testing"
import postgres from "postgres"

const { DATABASE_URL } = process.env

/** Selects the first value of a statement on `database`. */
async function selectValue(database: Database, text: string, parameters: string[] = []) {
  const { rows } = await database.execute(createStatement(text, parameters))
  return rows[0]![0]
}

describe.skipIf(!DATABASE_URL)("postgresJsDriver", () => {
  describeDriverContract(
    {
      createDriver: options => postgresJsDriver(postgres(DATABASE_URL!, options)),
      createDriverWithFailingParsers: () =>
        postgresJsDriver(
          postgres(DATABASE_URL!, {
            // postgres.js reads `integer` values with the parsers while it fetches types, which this parser would fail.
            fetch_types: false,
            types: {
              failing: {
                to: 23,
                from: [23],
                serialize: String,
                parse: () => {
                  throw new Error("parsed")
                },
              },
            },
          }),
        ),
    },
    { describe, it, before: beforeAll, after: afterAll },
  )

  describe("closing", () => {
    /** Creates a database whose client has one connection by default, so that a transaction waits for the connection of another one. */
    function createClosableDatabase(
      options: { max?: number; onclose?: () => void } & PostgresJsDriverOptions = {},
    ) {
      const { max = 1, onclose, closeTimeout } = options
      const driver = postgresJsDriver(postgres(DATABASE_URL!, { max, onclose }), { closeTimeout })
      return { driver, database: createDatabase({ driver }) }
    }

    /** Keeps an alive connection of `driver` reserved, as after a transaction that may have lost it. */
    async function keepConnection(driver: Driver) {
      const connection = await driver.acquire()
      await connection.release({ error: new Error("connection") })
    }

    it("waits for a transaction that gets a lost connection kept reserved once the pool reconnects it", async () => {
      await using admin = createDatabase({ driver: postgresJsDriver(postgres(DATABASE_URL!)) })
      const { promise: lost, resolve: loseConnection } = Promise.withResolvers<void>()
      // Waiting for the close timeout would outlast the test, so giving up on the transaction or on the lost connection fails it.
      const { driver, database } = createClosableDatabase({
        onclose: loseConnection,
        closeTimeout: 60,
      })

      const connection = await driver.acquire()
      const { rows } = await connection.execute(createStatement("SELECT pg_backend_pid()"))
      await selectValue(admin, "SELECT pg_terminate_backend($1)", [rows[0]![0]!])
      await lost
      await connection.release({ error: new Error("connection") })
      const waiting = database.transaction(() => selectValue(database, "SELECT 'waiting'"))
      await database.close()

      expect(await waiting).toBe("waiting")
    })

    it("terminates an alive connection kept reserved after the close timeout", async () => {
      const { driver, database } = createClosableDatabase({ closeTimeout: 0.1 })

      await keepConnection(driver)
      await database.close()
    })

    it("rejects a transaction waiting behind an alive connection kept reserved", async () => {
      const { driver, database } = createClosableDatabase({ closeTimeout: 0.1 })
      let called = false

      await keepConnection(driver)
      const waiting = database.transaction(async () => {
        called = true
      })
      waiting.catch(() => {})
      await database.close()

      await expect(waiting).rejects.toThrow("CONNECTION_DESTROYED")
      expect(called).toBe(false)
    })

    it("lets a query on the pool complete while a connection kept reserved delays closing", async () => {
      const { driver, database } = createClosableDatabase({ max: 2, closeTimeout: 1 })

      await keepConnection(driver)
      const query = selectValue(database, "SELECT 'slept' FROM pg_sleep(0.2)")
      await database.close()

      expect(await query).toBe("slept")
    })
  })
})
