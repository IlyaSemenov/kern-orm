import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import type { AddressInfo } from "node:net"
import { createServer } from "node:net"

import type { Database, Driver, SqlStatement } from "kern-db"
import {
  ConnectionError,
  createDatabase,
  createStatement,
  identifier,
  param,
  TransactionConnectionError,
} from "kern-db"
import { postgresJsConnection, postgresJsDriver } from "kern-db/postgres-js"
import { describeDriverContract } from "kern-db/testing"
import * as t from "kern-db/types"
import type { Sql } from "postgres"
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
      // Port 1 of the local host refuses connections.
      createUnreachableDriver: () => postgresJsDriver(postgres({ host: "127.0.0.1", port: 1 })),
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

  it("returns a connection to the pool after a statement that postgres.js refused to send", async () => {
    // One pooled connection makes the next statement run on the released connection unless postgres.js closed it.
    const driver = postgresJsDriver(postgres(DATABASE_URL!, { max: 1 }))
    try {
      const connection = await driver.acquire()
      let pid
      try {
        pid = (await connection.execute(createStatement("SELECT pg_backend_pid()"))).rows[0]![0]
        // postgres.js refuses a statement of 65534 parameters or more before sending it, which leaves the exchange of messages and the status of the connection intact.
        const error = await connection
          .execute(
            createStatement(
              "SELECT 1",
              Array.from({ length: 65534 }, () => null),
            ),
          )
          .catch((error: unknown) => error)
        expect(error).toBeInstanceOf(ConnectionError)
        expect(error).toMatchObject({
          message: expect.stringContaining("MAX_PARAMETERS_EXCEEDED"),
          unsent: true,
        })
      } finally {
        await connection.release()
      }

      const { rows } = await driver.execute(createStatement("SELECT pg_backend_pid()"))
      expect(rows[0]![0]).toBe(pid)
    } finally {
      await driver.close()
    }
  })

  describe("unsent of errors", () => {
    // The driver contract checks a connection that the server refuses.

    /** Expects a statement on the pool of `driver` to reject with an unsent `ConnectionError` whose cause has `code`. */
    async function expectUnsent(driver: Driver, code: unknown) {
      const error = await driver
        .execute(createStatement("SELECT 1"))
        .catch((error: unknown) => error)
      expect(error).toBeInstanceOf(ConnectionError)
      expect(error).toMatchObject({ unsent: true, cause: { code } })
    }

    /** Expects a statement on the pool of a new driver of `sql` to reject as `expectUnsent` checks, and closes the driver. */
    async function expectUnsentOnClient(sql: Sql, code: unknown) {
      const driver = postgresJsDriver(sql)
      try {
        await expectUnsent(driver, code)
      } finally {
        await driver.close()
      }
    }

    it("marks a host that is not found", async () => {
      // A name of the `.invalid` domain never resolves; a resolver that cannot reach DNS gives EAI_AGAIN instead.
      await expectUnsentOnClient(
        postgres({ host: "kern-db.invalid" }),
        expect.stringMatching(/^(?:ENOTFOUND|EAI_AGAIN)$/),
      )
    })

    it("marks a connection that does not start in time", async () => {
      // A server that accepts the connection and never answers.
      const server = createServer(() => {})
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
      const { port } = server.address() as AddressInfo
      try {
        await expectUnsentOnClient(
          postgres({ host: "127.0.0.1", port, connect_timeout: 0.1 }),
          "CONNECT_TIMEOUT",
        )
      } finally {
        server.close()
      }
    })

    it("marks a statement that waited too long for a connection", async () => {
      const driver = postgresJsDriver(postgres(DATABASE_URL!, { max: 1, queue_timeout: 0.1 }))
      try {
        const held = await driver.acquire()
        try {
          await expectUnsent(driver, "QUEUE_TIMEOUT")
        } finally {
          await held.release()
        }
      } finally {
        await driver.close()
      }
    })

    it("marks a statement of a client that ended", async () => {
      const sql = postgres(DATABASE_URL!)
      await sql.end()
      await expectUnsentOnClient(sql, "CONNECTION_ENDED")
    })

    // A sent statement gets its own FATAL error, which a function can raise with any code, such as with `plpy.fatal` of PL/Python.
    it.each(["28000", "28P01", "3D000", "53300", "57P03"])(
      "leaves unmarked a sent statement that gets FATAL %s, a code of a failed start",
      async code => {
        const createMessage = (type: string, body: Buffer) => {
          const header = Buffer.alloc(5)
          header.write(type)
          header.writeInt32BE(body.length + 4, 1)
          return Buffer.concat([header, body])
        }
        let received = false
        // A server that starts the session without authentication and fails the first statement.
        const server = createServer(socket => {
          let started = false
          socket.on("data", () => {
            if (!started) {
              started = true
              socket.write(createMessage("R", Buffer.from([0, 0, 0, 0])))
              socket.write(createMessage("Z", Buffer.from("I")))
              return
            }
            received = true
            const fields = `SFATAL\0VFATAL\0C${code}\0Mraised by a function\0\0`
            socket.end(createMessage("E", Buffer.from(fields)))
          })
        })
        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
        const { port } = server.address() as AddressInfo
        const driver = postgresJsDriver(
          postgres({ host: "127.0.0.1", port, fetch_types: false, max: 1 }),
        )
        try {
          const error = await driver
            .execute(createStatement("SELECT 1"))
            .catch((error: unknown) => error)

          expect(received).toBe(true)
          expect(error).toBeInstanceOf(ConnectionError)
          expect(error).toMatchObject({ unsent: false, cause: { code } })
        } finally {
          await driver.close()
          server.close()
        }
      },
    )
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
      let reserved
      try {
        reserved = await connection.execute(createStatement("SELECT 'kern'"))
      } finally {
        await connection.release()
      }

      // The client transforms the values of its own queries, but not those that the driver reads raw.
      expect(own).toEqual({ value: "transformed" })
      expect([pooled.rows, reserved.rows]).toEqual([[["kern"]], [["kern"]]])
    } finally {
      await driver.close()
    }
  })

  describe("native parameters", () => {
    const values = Symbol("values")
    let database: Database
    beforeAll(() => {
      database = createDatabase({
        driver: postgresJsDriver(postgres(DATABASE_URL!), {
          getNativeParameters: statement => (statement as { [values]?: unknown[] })[values],
        }),
      })
    })
    afterAll(() => database?.close())

    function createNativeStatement(text: string, parameters: unknown[]): SqlStatement {
      return { text, parameters: [], [values]: parameters } as SqlStatement
    }

    it("serializes values by the types that PostgreSQL resolves for their parameters", async () => {
      // The same value is a JSON array or a PostgreSQL array only by the type of its parameter.
      const statement = createNativeStatement(
        "SELECT ($1::jsonb)->>1 AS json, ($2::int[])[2] AS integers",
        [
          [1, 2],
          [1, 2],
        ],
      )
      expect((await database.execute(statement)).rows).toEqual([["2", "2"]])
    })

    it("runs on the connection of the transaction", async () => {
      await database.transaction(async () => {
        await database.query`SELECT set_config('kern.native_parameters', 'transaction', true)`
        const statement = createNativeStatement("SELECT current_setting($1)", [
          "kern.native_parameters",
        ])
        expect((await database.execute(statement)).rows).toEqual([["transaction"]])
      })
    })

    it("rejects a value that the client cannot serialize with ConnectionError, which rolls back the transaction", async () => {
      const statement = createNativeStatement("SELECT $1::jsonb", [{ amount: 1n }])
      await expect(
        database.transaction(async () => {
          await expect(database.execute(statement)).rejects.toBeInstanceOf(ConnectionError)
        }),
      ).rejects.toBeInstanceOf(TransactionConnectionError)
    })
  })
})

describe.skipIf(!DATABASE_URL)("postgresJsConnection", () => {
  /** Client whose transactions the tests own, as an application that keeps its transactions in postgres.js. */
  let sql: Sql
  /** Database of kern-db of the application, on a pool of its own, apart from the connection of the transactions of `sql`. */
  let database: Database
  beforeAll(() => {
    sql = postgres(DATABASE_URL!, { max: 1 })
    database = createDatabase({ driver: postgresJsDriver(postgres(DATABASE_URL!, { max: 1 })) })
  })
  afterAll(async () => {
    await database.close()
    await sql.end()
  })

  /** Error that rolls back a transaction of `sql.begin` on purpose. */
  class Rollback extends Error {}

  it("runs the queries of an external transaction in a transaction of sql.begin, which its client rolls back", async () => {
    let seen: unknown
    const transaction = sql.begin(async tx => {
      // The table would outlive a transaction that committed, for the check after the rollback.
      await tx`CREATE TEMP TABLE kern_external (id integer, tags jsonb)`
      seen = await database.externalTransaction(postgresJsConnection(tx), async () => {
        await database.transaction(async () => {
          await database.query`INSERT INTO kern_external VALUES (${1}, ${param(t.jsonb, ["a"])})`
        })
        return await database.query`SELECT id, tags FROM kern_external`
          .take()
          .select({ id: t.integer, tags: t.jsonb })
      })
      expect([...(await tx`SELECT id FROM kern_external`)]).toEqual([{ id: 1 }])
      throw new Rollback()
    })

    await expect(transaction).rejects.toBeInstanceOf(Rollback)
    expect(seen).toEqual({ id: 1, tags: ["a"] })
    expect([...(await sql`SELECT to_regclass('pg_temp.kern_external') AS name`)]).toEqual([
      { name: null },
    ])
  })

  it("runs in a savepoint of sql.savepoint on the client of the savepoint", async () => {
    const rows = await sql.begin(async tx => {
      await tx`CREATE TEMP TABLE kern_external (id integer) ON COMMIT DROP`
      await tx
        .savepoint(async savepoint => {
          await database.externalTransaction(postgresJsConnection(savepoint), async () => {
            await database.query`INSERT INTO kern_external VALUES (1)`
          })
          throw new Rollback()
        })
        .catch((error: unknown) => {
          if (!(error instanceof Rollback)) {
            throw error
          }
        })
      return [...(await tx`SELECT id FROM kern_external`)]
    })

    expect(rows).toEqual([])
  })

  describe("when the callback of sql.begin resolves", () => {
    /** Table that outlives the transactions of the tests, so that the connection of the database reads what they committed. */
    const name = `kern_external_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`
    const table = identifier("public", name)
    beforeAll(() => database.script`CREATE TABLE ${table} (id integer)`)
    afterAll(() => database.script`DROP TABLE IF EXISTS ${table}`)

    const readCommitted = () => database.query`SELECT id FROM ${table} ORDER BY id`.pluck(t.integer)

    it("commits the statements of the callback, without those of a nested transaction that its callback rolled back", async () => {
      const failure = new Error("failure")

      await sql.begin(async tx => {
        await database.externalTransaction(postgresJsConnection(tx), async () => {
          await database.query`INSERT INTO ${table} VALUES (1)`
          const thrown = database.transaction(async () => {
            await database.query`INSERT INTO ${table} VALUES (2)`
            throw failure
          })
          await expect(thrown).rejects.toBe(failure)
        })
      })

      expect(await readCommitted()).toEqual([1])
    })

    // postgres.js remembers a failed statement of the client of a transaction, whatever savepoint rolled it back.
    it("rejects and commits nothing after a nested transaction of the database rolled back a failed statement", async () => {
      let rows: unknown
      const transaction = sql.begin(async tx => {
        await database.externalTransaction(postgresJsConnection(tx), async () => {
          const failed = database.transaction(async () => {
            await database.query`INSERT INTO ${table} VALUES (3)`
            await database.query`SELECT 1 / 0`
          })
          await expect(failed).rejects.toMatchObject({ code: "22012" })
          await database.query`INSERT INTO ${table} VALUES (4)`
        })
        // The transaction stays usable until postgres.js ends it.
        rows = [...(await tx`SELECT id FROM public.${tx(name)} WHERE id > 2`)]
      })

      await expect(transaction).rejects.toMatchObject({ code: "22012" })
      expect(rows).toEqual([{ id: 4 }])
      expect(await readCommitted()).not.toContain(4)
    })
  })
})
