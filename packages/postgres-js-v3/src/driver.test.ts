import { describe, expect, it } from "bun:test"

import { createStatement } from "kern-orm"
import type { Sql } from "postgres"

import type { PostgresJsDriverOptions } from "./driver"
import { postgresJsDriver } from "./driver"

describe("statements", () => {
  /** Fake postgres.js client that records the parameters and options of its statements and the scripts of the simple protocol, and answers them with no rows. */
  function createRecordingClient() {
    const sent: unknown[][] = []
    const options: unknown[] = []
    const scripts: string[] = []
    const sql = {
      typed: (value: unknown, type: number) => ({ value, type }),
      unsafe(text: string, parameters?: unknown[], queryOptions?: unknown) {
        return {
          raw() {
            sent.push(parameters!)
            options.push(queryOptions)
            return Promise.resolve(Object.assign([], { command: "SELECT", columns: [] }))
          },
          simple: () => ({
            raw() {
              scripts.push(text)
              return Promise.resolve([])
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
})

class FakePostgresError extends Error {
  constructor(
    readonly code: string,
    readonly severity = "ERROR",
  ) {
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
    PostgresError: FakePostgresError,
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

describe("release after a failed end of a transaction", () => {
  it("releases an idle connection after a server error", async () => {
    const { driver, sent, isReleased } = createFakeClient(() => {})
    const connection = await driver.acquire()

    await connection.release({ error: new FakePostgresError("23505") })

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

    await connection.release({ error: new FakePostgresError("57014") })

    expect(sent).toEqual(["SELECT 1", "ROLLBACK"])
    expect(isReleased()).toBe(true)
  })

  it("rejects with a failed rollback and keeps the connection reserved", async () => {
    const rollbackError = new FakePostgresError("XX000")
    const { driver, isReleased } = createFakeClient(text => {
      if (text === "SELECT 1") {
        throw new FakePostgresError("25P02")
      }
      throw rollbackError
    })
    const connection = await driver.acquire()

    await expect(connection.release({ error: new FakePostgresError("57014") })).rejects.toBe(
      rollbackError,
    )
    expect(isReleased()).toBe(false)
  })

  it("rejects with an unexpected probe error and keeps the connection reserved", async () => {
    const probeError = new Error("probe")
    const { driver, isReleased } = createFakeClient(() => {
      throw probeError
    })
    const connection = await driver.acquire()

    await expect(connection.release({ error: new FakePostgresError("57014") })).rejects.toBe(
      probeError,
    )
    expect(isReleased()).toBe(false)
  })

  it("leaves a connection that may be lost reserved without sending statements", async () => {
    const { driver, sent, isReleased } = createFakeClient(() => {})

    for (const error of [new Error("connection"), new FakePostgresError("57P01", "FATAL")]) {
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

    await expect(driver.acquire()).rejects.toThrow(
      "Cannot acquire a connection: the driver is closed",
    )
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

    await expect(waiting).rejects.toThrow("Cannot acquire a connection: the driver is closed")
    expect(isReleased()).toBe(true)
    expect(endings).toEqual([{ timeout: 0 }])
  })
})
