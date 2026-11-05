import { afterAll, beforeAll, describe, expect, it } from "bun:test"

import { postgresJsDriver } from "@kern-orm/postgres-js"
import { createStatement } from "kern-orm"
import { describeDriverContract } from "kern-orm/testing"
import postgres from "postgres"

const { DATABASE_URL } = process.env

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
      closesReservedConnections: true,
    },
    { describe, it, before: beforeAll, after: afterAll },
  )

  it("acquires the first connection of a client that does not fetch types", async () => {
    const driver = postgresJsDriver(postgres(DATABASE_URL!, { fetch_types: false }))
    try {
      // Acquiring before any statement makes the reserve open the first connection of the pool.
      const connection = await driver.acquire()
      const { rows } = await connection.execute(createStatement("SELECT 1"))
      await connection.release()

      expect(rows).toEqual([["1"]])
    } finally {
      await driver.close()
    }
  })
})
