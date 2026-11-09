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

  it("reads values as PostgreSQL returns them from a client that transforms values", async () => {
    const sql = postgres(DATABASE_URL!, {
      transform: { value: value => (value === "kern" ? "transformed" : value) },
    })
    const driver = postgresJsDriver(sql)
    try {
      const [own] = await sql`SELECT 'kern' AS value`
      const pooled = await driver.execute(createStatement("SELECT 'kern'"))
      const connection = await driver.acquire()
      const reserved = await connection.execute(createStatement("SELECT 'kern'")).then(
        async result => {
          await connection.release()
          return result
        },
        async (error: unknown) => {
          await connection.release({ error })
          throw error
        },
      )

      // The client transforms the values of its own queries, but not those that the driver reads raw.
      expect(own).toEqual({ value: "transformed" })
      expect([pooled.rows, reserved.rows]).toEqual([[["kern"]], [["kern"]]])
    } finally {
      await driver.close()
    }
  })
})
