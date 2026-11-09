import { afterAll, beforeAll, describe, expect, it } from "bun:test"

import { nodePostgresDriver } from "@kern-orm/node-postgres"
import type { Driver, TextValue } from "kern-orm"
import { createStatement } from "kern-orm"
import { describeDriverContract } from "kern-orm/testing"
import type { PoolConfig } from "pg"
import { Pool } from "pg"

const { DATABASE_URL } = process.env

/** Creates a pool of the test database. */
function createPool(config?: PoolConfig) {
  return new Pool({ connectionString: DATABASE_URL, ...config })
}

/** Selects the first value of a statement on the pool of `driver`. */
async function selectValue(driver: Driver, text: string, parameters: readonly TextValue[] = []) {
  const { rows } = await driver.execute(createStatement(text, parameters))
  return rows[0]![0]
}

describe.skipIf(!DATABASE_URL)("nodePostgresDriver", () => {
  describeDriverContract(
    {
      createDriver: options => nodePostgresDriver(createPool(options)),
      createDriverWithFailingParsers: () =>
        nodePostgresDriver(
          createPool({
            types: {
              getTypeParser: () => () => {
                throw new Error("parsed")
              },
            },
          }),
        ),
    },
    { describe, it, before: beforeAll, after: afterAll },
  )

  // Runs the statements that terminate the connections of the other drivers.
  const admin = nodePostgresDriver(createPool())
  afterAll(() => admin.close())

  it("rejects a pool with the binary option", async () => {
    // `pg` reads `binary` of a pool, though its types omit it.
    const driver = nodePostgresDriver(createPool({ binary: true } as PoolConfig))
    try {
      await expect(selectValue(driver, "SELECT 1")).rejects.toThrow(
        "nodePostgresDriver requires text results",
      )
    } finally {
      await driver.close()
    }
  })

  it("rejects the next statement of a reserved connection that broke, and replaces the connection", async () => {
    // One pooled connection makes the next statement run on the connection that replaces the lost one.
    const pool = createPool({ max: 1 })
    const { promise: broken, resolve: onBroken } = Promise.withResolvers<void>()
    pool.once("acquire", client => client.once("end", onBroken))
    const driver = nodePostgresDriver(pool)
    try {
      const connection = await driver.acquire()
      const { rows } = await connection.execute(createStatement("SELECT pg_backend_pid()"))
      await selectValue(admin, "SELECT pg_terminate_backend($1)", [rows[0]![0]!])
      // The client emits `error` without a running query, which would terminate the process without a listener.
      await broken

      const error = await connection
        .execute(createStatement("SELECT 1"))
        .catch((error: unknown) => error)
      expect(error).toBeInstanceOf(Error)
      await connection.release({ error })

      expect(await selectValue(driver, "SELECT 'usable'")).toBe("usable")
    } finally {
      await driver.close()
    }
  })

  it("keeps the connection of a statement on the pool that PostgreSQL rejected", async () => {
    // One pooled connection makes every statement run on the same connection while it stays open.
    const driver = nodePostgresDriver(createPool({ max: 1 }))
    try {
      const pid = await selectValue(driver, "SELECT pg_backend_pid()")
      await expect(selectValue(driver, "SELECT 1/0")).rejects.toThrow("division by zero")

      expect(await selectValue(driver, "SELECT pg_backend_pid()")).toBe(pid)
    } finally {
      await driver.close()
    }
  })

  it("closes the connection of a statement on the pool that timed out in the client", async () => {
    // One pooled connection would make the next statement wait for the running one, were the connection kept.
    const driver = nodePostgresDriver(createPool({ max: 1, query_timeout: 100 }))
    try {
      const pid = await selectValue(driver, "SELECT pg_backend_pid()")
      await expect(selectValue(driver, "SELECT pg_sleep(1)")).rejects.toThrow("Query read timeout")

      expect(await selectValue(driver, "SELECT pg_backend_pid()")).not.toBe(pid)
    } finally {
      await driver.close()
    }
  })
})
