import { describe, expect, it } from "bun:test"

import { ConnectionError, createStatement, QueryError } from "kern-orm"
import type { Sql } from "postgres"
import postgres from "postgres"

import type { PostgresJsDriverOptions } from "./driver"
import { postgresJsDriver } from "./driver"

describe("statements", () => {
  /**
   * Fake postgres.js client that records the parameters and options of its statements and the scripts of the simple protocol, and answers them with no rows.
   *
   * It rejects its statements and scripts with `failure`, when given.
   */
  function createRecordingClient(failure?: unknown) {
    const sent: unknown[][] = []
    const options: unknown[] = []
    const scripts: string[] = []
    const answer = <T>(value: T) => (failure ? Promise.reject(failure) : Promise.resolve(value))
    const sql = {
      options: { transform: { column: {}, value: {}, row: {} } },
      typed: (value: unknown, type: number) => ({ value, type }),
      unsafe(text: string, parameters?: unknown[], queryOptions?: unknown) {
        return {
          raw() {
            sent.push(parameters!)
            options.push(queryOptions)
            return answer(Object.assign([], { command: "SELECT", columns: [] }))
          },
          simple: () => ({
            raw() {
              scripts.push(text)
              return answer([])
            },
          }),
        }
      },
    }
    return { driver: postgresJsDriver(sql as unknown as Sql), sent, options, scripts }
  }

  it("sends every parameter, including null, with the unknown type", async () => {
    const { driver, sent } = createRecordingClient()

    await driver.execute(createStatement("SELECT $1, $2", ["1", null]))

    expect(sent).toEqual([
      [
        { value: "1", type: 705 },
        { value: null, type: 705 },
      ],
    ])
  })

  it("sends a statement without parameters with the extended protocol", async () => {
    const { driver, options } = createRecordingClient()

    await driver.execute(createStatement("SELECT 1"))

    expect(options).toEqual([{ simple: false }])
  })

  it("executes a script with the simple protocol, which takes several statements", async () => {
    const { driver, sent, scripts } = createRecordingClient()

    await driver.executeScript("CREATE TABLE a (id integer); CREATE TABLE b (id integer)")

    expect(scripts).toEqual(["CREATE TABLE a (id integer); CREATE TABLE b (id integer)"])
    expect(sent).toEqual([])
  })

  it("rejects a statement and a script that PostgreSQL rejected with QueryError of the code and constraint_name of the error", async () => {
    const failure = Object.assign(new Error("duplicate key"), {
      severity: "ERROR",
      severity_local: "ОШИБКА",
      code: "23505",
      constraint_name: "form_pkey",
    })
    const { driver } = createRecordingClient(failure)

    for (const operation of [
      driver.execute(createStatement("INSERT")),
      driver.executeScript("INSERT"),
    ]) {
      const error = await operation.catch((error: unknown) => error)
      expect(error).toBeInstanceOf(QueryError)
      expect(error).toMatchObject({ code: "23505", constraint: "form_pkey", cause: failure })
    }
  })

  it("classifies an error by its severity in English rather than the translated one", async () => {
    // A recovery conflict on a replica ends the session with a code that a statement also gets.
    const failure = Object.assign(new Error("canceling statement due to conflict with recovery"), {
      severity: "FATAL",
      severity_local: "ВАЖНО",
      code: "40001",
    })
    const { driver } = createRecordingClient(failure)

    await expect(driver.execute(createStatement("SELECT 1"))).rejects.toBeInstanceOf(
      ConnectionError,
    )
  })

  it("rejects a failure of the client with ConnectionError", async () => {
    const failure = Object.assign(new Error("write CONNECTION_CLOSED"), {
      code: "CONNECTION_CLOSED",
    })
    const { driver } = createRecordingClient(failure)

    const error = await driver.execute(createStatement("SELECT 1")).catch((error: unknown) => error)

    expect(error).toBeInstanceOf(ConnectionError)
    expect(error).toMatchObject({ cause: failure })
  })
})

/** Fake error of postgres.js of a statement that PostgreSQL rejected. */
class FakePostgresError extends Error {
  readonly severity = "ERROR"

  constructor(readonly code: string) {
    super(code)
  }
}

/** Fake postgres.js client whose reserved connection answers statements with `respond` and records them. */
function createFakeClient(respond: (text: string) => void, options?: PostgresJsDriverOptions) {
  const sent: string[] = []
  const endings: unknown[] = []
  let released = false
  const reserved = {
    async unsafe(text: string) {
      sent.push(text)
      respond(text)
      return []
    },
    release() {
      released = true
    },
  }
  const sql = {
    options: { transform: { column: {}, value: {}, row: {} } },
    reserve: () => Promise.resolve(reserved),
    end(options: unknown) {
      endings.push(options)
      return Promise.resolve()
    },
  }
  return {
    driver: postgresJsDriver(sql as unknown as Sql, options),
    client: sql,
    sent,
    endings,
    isReleased: () => released,
  }
}

it("reports that it cannot close a reserved connection", () => {
  const { driver } = createFakeClient(() => {})

  expect(driver.closesReservedConnections).toBe(false)
})

describe("transforms of the client", () => {
  // The driver reads the transforms at creation, so the clients never connect.
  it.each([
    { name: "postgres.camel", transform: postgres.camel },
    {
      name: "a transform of column names",
      transform: { column: (name: string) => name.toUpperCase() },
    },
    { name: "a transform of rows", transform: { row: (row: unknown) => row } },
  ])("throws TypeError for a client with $name", async ({ transform }) => {
    const sql = postgres({ transform })
    try {
      expect(() => postgresJsDriver(sql)).toThrow(TypeError)
    } finally {
      await sql.end()
    }
  })

  it("accepts a client with a transform of values", async () => {
    const sql = postgres({ transform: { value: () => "transformed" } })
    try {
      expect(() => postgresJsDriver(sql)).not.toThrow()
    } finally {
      await sql.end()
    }
  })
})

it("rejects a failure to reserve a connection with ConnectionError whatever its fields", async () => {
  const reserveFailure = new FakePostgresError("42P01")
  const { driver, client } = createFakeClient(() => {})
  client.reserve = () => Promise.reject(reserveFailure)

  const error = await driver.acquire().catch((error: unknown) => error)

  expect(error).toBeInstanceOf(ConnectionError)
  expect(error).toMatchObject({ cause: reserveFailure })
})

describe("release after a failed statement", () => {
  it("releases an idle connection after a server error", async () => {
    const { driver, sent, isReleased } = createFakeClient(() => {})
    const connection = await driver.acquire()

    await connection.release({ error: new QueryError("duplicate key", { code: "23505" }) })

    expect(sent).toEqual(["SELECT 1"])
    expect(isReleased()).toBe(true)
  })

  it("rolls back a failed transaction before releasing its connection", async () => {
    const { driver, sent, isReleased } = createFakeClient(text => {
      if (text === "SELECT 1") {
        throw new FakePostgresError("25P02")
      }
    })
    const connection = await driver.acquire()

    await connection.release({ error: new QueryError("canceled", { code: "57014" }) })

    expect(sent).toEqual(["SELECT 1", "ROLLBACK"])
    expect(isReleased()).toBe(true)
  })

  it("rejects with the classified error of a failed rollback and keeps the connection reserved", async () => {
    const rollbackError = new FakePostgresError("XX000")
    const { driver, isReleased } = createFakeClient(text => {
      if (text === "SELECT 1") {
        throw new FakePostgresError("25P02")
      }
      throw rollbackError
    })
    const connection = await driver.acquire()

    const error = await Promise.resolve(
      connection.release({ error: new QueryError("canceled", { code: "57014" }) }),
    ).catch((error: unknown) => error)

    expect(error).toBeInstanceOf(QueryError)
    expect(error).toMatchObject({ code: "XX000", cause: rollbackError })
    expect(isReleased()).toBe(false)
  })

  it("rejects with the classified error of an unexpected probe error and keeps the connection reserved", async () => {
    const probeError = new Error("probe")
    const { driver, isReleased } = createFakeClient(() => {
      throw probeError
    })
    const connection = await driver.acquire()

    const error = await Promise.resolve(
      connection.release({ error: new QueryError("canceled", { code: "57014" }) }),
    ).catch((error: unknown) => error)

    expect(error).toBeInstanceOf(ConnectionError)
    expect(error).toMatchObject({ cause: probeError })
    expect(isReleased()).toBe(false)
  })

  it("leaves a connection that may be lost reserved without sending statements", async () => {
    const { driver, sent, isReleased } = createFakeClient(() => {})

    for (const error of [
      new ConnectionError("terminating connection"),
      // An error that the driver did not classify, such as of the code of a caller.
      new Error("connection"),
    ]) {
      const connection = await driver.acquire()
      await connection.release({ error })
    }

    expect(sent).toEqual([])
    expect(isReleased()).toBe(false)
  })
})

describe("closing", () => {
  it("rejects acquiring a connection after closing starts", async () => {
    const { driver } = createFakeClient(() => {})

    const closing = driver.close()

    const error = await driver.acquire().catch((error: unknown) => error)

    expect(error).toBeInstanceOf(ConnectionError)
    expect(error).toMatchObject({ message: "Cannot acquire a connection: the driver is closed" })
    await closing
  })

  it("waits for a transaction that gets a connection before the close timeout, however long it runs", async () => {
    const { driver, client, endings } = createFakeClient(() => {}, { closeTimeout: 0.01 })
    const { promise: reserving, resolve: handConnection } = Promise.withResolvers<void>()
    const reserve = client.reserve
    client.reserve = () => reserving.then(reserve)
    let closed = false

    const waiting = driver.acquire()
    const closing = driver.close().then(() => {
      closed = true
    })
    handConnection()
    const connection = await waiting
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(closed).toBe(false)
    expect(endings).toEqual([])
    await connection.release()
    await closing
    expect(endings).toEqual([undefined])
  })

  it("gives up on a pending acquire after the close timeout and releases the connection it gets later", async () => {
    const { driver, client, endings, isReleased } = createFakeClient(() => {}, { closeTimeout: 0 })
    const { promise: reserving, resolve: handConnection } = Promise.withResolvers<void>()
    const reserve = client.reserve
    client.reserve = () => reserving.then(reserve)

    const waiting = driver.acquire()
    await driver.close()
    handConnection()

    await expect(waiting).rejects.toBeInstanceOf(ConnectionError)
    await expect(waiting).rejects.toThrow("Cannot acquire a connection: the driver is closed")
    expect(isReleased()).toBe(true)
    expect(endings).toEqual([{ timeout: 0 }])
  })
})
