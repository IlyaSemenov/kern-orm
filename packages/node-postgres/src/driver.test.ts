import { describe, expect, it } from "bun:test"
import { EventEmitter } from "node:events"

import type { Driver } from "kern-orm"
import { createStatement } from "kern-orm"
import { Pool } from "pg"

import { nodePostgresDriver } from "./driver"

/** Config of a query as the fake client records it. */
interface RecordedQuery {
  text: string
  values?: unknown[]
  rowMode?: string
  queryMode?: string
  types?: { getTypeParser: () => (value: string) => unknown }
}

/** Fake node-postgres client that records its queries and releases; a query answers with no rows unless `respond` answers it. */
function createFakeClient(respond?: (query: RecordedQuery) => Promise<unknown>) {
  const queries: RecordedQuery[] = []
  const releases: unknown[] = []
  const client = Object.assign(new EventEmitter(), {
    query(query: RecordedQuery) {
      queries.push(query)
      return respond
        ? respond(query)
        : Promise.resolve({ command: "SELECT", rowCount: 0, fields: [], rows: [] })
    },
    release(destroy: unknown) {
      releases.push(destroy)
    },
  })
  return { client, queries, releases }
}

/** Fake node-postgres pool over `client`; `connect` can delay handing it out or fail. */
function createFakePool(client: unknown, connect = () => Promise.resolve(client)) {
  let ended = 0
  const pool = Object.assign(new EventEmitter(), {
    connect,
    end() {
      ended++
      return Promise.resolve()
    },
  })
  return { pool: pool as unknown as Pool, getEndCount: () => ended }
}

/** Creates a driver over a fake pool with one fake client. */
function createFakeDriver(respond?: (query: RecordedQuery) => Promise<unknown>) {
  const fake = createFakeClient(respond)
  const { pool } = createFakePool(fake.client)
  return { ...fake, pool, driver: nodePostgresDriver(pool) }
}

it("sends a statement with the extended protocol and reads its rows as arrays", async () => {
  const { driver, queries } = createFakeDriver()

  await driver.execute(createStatement("SELECT $1, $2", ["1", null]))

  expect(queries).toEqual([
    {
      text: "SELECT $1, $2",
      values: ["1", null],
      rowMode: "array",
      queryMode: "extended",
      types: expect.anything(),
    },
  ])
})

it("keeps the values of a statement as text without the parsers of the client", async () => {
  const { driver, queries } = createFakeDriver()

  await driver.execute(createStatement("SELECT 1"))

  expect(queries[0]!.types!.getTypeParser()("1")).toBe("1")
})

it("returns the command, the number of rows, the columns, and the rows of a statement", async () => {
  const { driver } = createFakeDriver(() =>
    Promise.resolve({
      command: "SELECT",
      rowCount: 1,
      fields: [{ name: "id" }, { name: "label" }],
      rows: [["1", null]],
    }),
  )

  expect(await driver.execute(createStatement("SELECT 1"))).toEqual({
    command: "SELECT",
    count: 1,
    columns: ["id", "label"],
    rows: [["1", null]],
  })
})

it("reports a count of 0 for a command tag without a number of rows", async () => {
  const { driver } = createFakeDriver(() =>
    Promise.resolve({ command: "BEGIN", rowCount: null, fields: [], rows: [] }),
  )

  expect((await driver.execute(createStatement("BEGIN"))).count).toBe(0)
})

it("executes a script with the simple protocol, which takes several statements", async () => {
  const { driver, queries } = createFakeDriver()

  await driver.executeScript("CREATE TABLE a (id integer); CREATE TABLE b (id integer)")

  expect(queries).toEqual([
    {
      text: "CREATE TABLE a (id integer); CREATE TABLE b (id integer)",
      rowMode: "array",
      types: expect.anything(),
    },
  ])
  expect(queries[0]!.types!.getTypeParser()("1")).toBe("1")
})

describe("connection", () => {
  it("runs its statements and scripts one at a time in the order of calls", async () => {
    const answers: PromiseWithResolvers<unknown>[] = []
    const { driver, queries } = createFakeDriver(() => {
      const answer = Promise.withResolvers<unknown>()
      answers.push(answer)
      return answer.promise
    })
    const connection = await driver.acquire()
    const result = { command: "SELECT", rowCount: 0, fields: [], rows: [] }

    const statement1 = connection.execute(createStatement("SELECT 1"))
    const statement2 = connection.executeScript("SELECT 2")
    const statement3 = connection.execute(createStatement("SELECT 3"))

    await Promise.resolve()
    await Promise.resolve()
    expect(queries.map(({ text }) => text)).toEqual(["SELECT 1"])

    answers[0]!.resolve(result)
    await statement1
    await Promise.resolve()
    expect(queries.map(({ text }) => text)).toEqual(["SELECT 1", "SELECT 2"])

    answers[1]!.resolve(result)
    await statement2
    await Promise.resolve()
    expect(queries.map(({ text }) => text)).toEqual(["SELECT 1", "SELECT 2", "SELECT 3"])

    answers[2]!.resolve(result)
    await statement3
  })

  it("runs a statement after the failure of the previous one", async () => {
    const failure = new Error("failure")
    const { driver } = createFakeDriver(({ text }) =>
      text === "SELECT 1"
        ? Promise.reject(failure)
        : Promise.resolve({ command: text, rowCount: 0, fields: [], rows: [] }),
    )
    const connection = await driver.acquire()

    const failed = connection.execute(createStatement("SELECT 1"))
    const next = connection.execute(createStatement("SELECT 2"))

    await expect(failed).rejects.toBe(failure)
    expect((await next).command).toBe("SELECT 2")
  })

  it("returns to the pool after a transaction", async () => {
    const { driver, releases } = createFakeDriver()

    const connection = await driver.acquire()
    await connection.release()

    expect(releases).toEqual([false])
  })

  it("closes when released with a failure instead of returning to the pool", async () => {
    const { driver, releases } = createFakeDriver()

    const connection = await driver.acquire()
    await connection.release({ error: new Error("failure") })

    expect(releases).toEqual([true])
  })
})

describe("statement on the pool", () => {
  it.each([
    ["execute", (driver: Driver) => driver.execute(createStatement("SELECT 1"))],
    ["executeScript", (driver: Driver) => driver.executeScript("SELECT 1")],
  ])("%s returns its client to the pool", async (_name, run) => {
    const { driver, releases } = createFakeDriver()

    await run(driver)

    expect(releases).toEqual([false])
  })

  it("keeps the connection of a statement that PostgreSQL rejected", async () => {
    const failure = Object.assign(new Error("division by zero"), { severity: "ERROR" })
    const { driver, releases } = createFakeDriver(() => Promise.reject(failure))

    await expect(driver.execute(createStatement("SELECT 1/0"))).rejects.toBe(failure)

    expect(releases).toEqual([false])
  })

  it.each([
    ["a fatal error", Object.assign(new Error("terminating connection"), { severity: "FATAL" })],
    ["a failure of the client", new Error("Query read timeout")],
  ])("closes the connection after %s", async (_name, failure) => {
    const { driver, releases } = createFakeDriver(() => Promise.reject(failure))

    await expect(driver.execute(createStatement("SELECT 1"))).rejects.toBe(failure)

    expect(releases).toEqual([true])
  })
})

describe.each([
  ["of pg.native", { native: {} }, "nodePostgresDriver requires the JavaScript client"],
  ["with the binary option", { binary: true }, "nodePostgresDriver requires text results"],
])("client %s", (_name, properties, message) => {
  /** Creates a driver over a fake pool whose client has the `properties`. */
  function createUnsupportedDriver() {
    const fake = createFakeClient()
    const { pool, getEndCount } = createFakePool(Object.assign(fake.client, properties))
    return { ...fake, getEndCount, driver: nodePostgresDriver(pool) }
  }

  it("rejects acquiring a connection and statements on the pool, without sending them", async () => {
    const { driver, queries } = createUnsupportedDriver()

    await expect(driver.acquire()).rejects.toThrow(message)
    await expect(driver.execute(createStatement("SELECT 1"))).rejects.toThrow(message)
    await expect(driver.executeScript("SELECT 1")).rejects.toThrow(message)

    expect(queries).toEqual([])
  })

  it("returns the client to the pool, which closing then ends", async () => {
    const { driver, releases, getEndCount } = createUnsupportedDriver()

    await expect(driver.acquire()).rejects.toThrow(message)
    await driver.close()

    expect(releases).toHaveLength(1)
    expect(getEndCount()).toBe(1)
  })
})

describe("errors of a client of a real pool", () => {
  /** Client of a pool without a connection, which `lose` makes emit `error`. */
  class FakeClient extends EventEmitter {
    _queryable = true

    connect(callback: () => void) {
      callback()
    }

    end(callback?: () => void) {
      callback?.()
    }

    lose() {
      this.emit("error", new Error("terminating connection"))
    }
  }

  /** Client whose connection breaks as soon as it opens, as when the messages that open it and report the failure come in one read. */
  class BrokenClient extends FakeClient {
    override connect(callback: () => void) {
      callback()
      this.lose()
    }
  }

  it("are ignored from the moment the pool hands out a client", async () => {
    const driver = nodePostgresDriver(new Pool({ Client: BrokenClient as never }))

    const connection = await driver.acquire()
    await connection.release()

    await driver.close()
  })

  it("are ignored while the pool verifies a new client", async () => {
    const driver = nodePostgresDriver(
      new Pool({
        Client: FakeClient as never,
        verify(client, done) {
          client.emit("error", new Error("terminating connection"))
          done()
        },
      }),
    )

    const connection = await driver.acquire()
    await connection.release()

    await driver.close()
  })

  it("are ignored while a client is held, without accumulating listeners across checkouts", async () => {
    let held: FakeClient | undefined
    const pool = new Pool({ Client: FakeClient as never })
    pool.on("acquire", client => {
      held = client as unknown as FakeClient
    })
    const driver = nodePostgresDriver(pool)

    for (let checkout = 0; checkout < 3; checkout++) {
      const connection = await driver.acquire()
      held!.lose()
      await connection.release()
    }

    // Only the listener of the pool stays on an idle client.
    expect(held!.listenerCount("error")).toBe(1)
    await driver.close()
  })
})

it("ignores an error of the pool, which removes an idle connection that breaks by itself", () => {
  const { pool } = createFakeDriver()

  // An `EventEmitter` throws an `error` event without a listener.
  expect(() => pool.emit("error", new Error("failure"))).not.toThrow()
})

describe("closing", () => {
  it("rejects acquiring a connection and statements on the pool after it starts", async () => {
    const { driver } = createFakeDriver()

    const closing = driver.close()

    await expect(driver.acquire()).rejects.toThrow(
      "Cannot acquire a connection: the driver is closed",
    )
    await expect(driver.execute(createStatement("SELECT 1"))).rejects.toThrow(
      "Cannot execute a statement: the driver is closed",
    )
    await expect(driver.executeScript("SELECT 1")).rejects.toThrow(
      "Cannot execute a script: the driver is closed",
    )
    await closing
  })

  it("ends the pool once", async () => {
    const { client } = createFakeClient()
    const { pool, getEndCount } = createFakePool(client)
    const driver = nodePostgresDriver(pool)

    await Promise.all([driver.close(), driver.close()])

    expect(getEndCount()).toBe(1)
  })

  it("ends the pool once the reserved connections return and those waiting for a connection get one", async () => {
    const { client } = createFakeClient()
    const handOut = Promise.withResolvers<unknown>()
    const { pool, getEndCount } = createFakePool(client, () => handOut.promise)
    const driver = nodePostgresDriver(pool)

    const acquiring = driver.acquire()
    const closing = driver.close()
    await Promise.resolve()
    expect(getEndCount()).toBe(0)

    handOut.resolve(client)
    const connection = await acquiring
    await Promise.resolve()
    expect(getEndCount()).toBe(0)

    await connection.release()
    await closing
    expect(getEndCount()).toBe(1)
  })

  it("ends the pool after a failure to get a connection", async () => {
    const failure = new Error("failure")
    const { pool, getEndCount } = createFakePool(undefined, () => Promise.reject(failure))
    const driver = nodePostgresDriver(pool)

    const acquiring = driver.acquire()
    const closing = driver.close()

    await expect(acquiring).rejects.toBe(failure)
    await closing
    expect(getEndCount()).toBe(1)
  })
})
