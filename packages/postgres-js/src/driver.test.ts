import { describe, expect, it } from "bun:test"

import { ConnectionError, createStatement, QueryError } from "kern-orm"
import type { Sql } from "postgres"

import { postgresJsDriver } from "./driver"

/**
 * Fake postgres.js client that records the parameters and options of its statements and the scripts of the simple protocol, and answers them with no rows.
 *
 * It rejects its statements and scripts with `failure`, and reserving a connection with `reserveFailure`, when given.
 */
function createFakeClient({
  failure,
  reserveFailure,
}: { failure?: unknown; reserveFailure?: unknown } = {}) {
  const sent: unknown[][] = []
  const options: unknown[] = []
  const scripts: string[] = []
  const answer = <T>(value: T) => (failure ? Promise.reject(failure) : Promise.resolve(value))
  const sql = {
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
    reserve: () =>
      reserveFailure ? Promise.reject(reserveFailure) : Promise.resolve({ release() {} }),
    end: () => Promise.resolve(),
  }
  return { driver: postgresJsDriver(sql as unknown as Sql), sent, options, scripts }
}

it("sends every parameter, including null, with the unknown type", async () => {
  const { driver, sent } = createFakeClient()

  await driver.execute(createStatement("SELECT $1, $2", ["1", null]))

  expect(sent).toEqual([
    [
      { value: "1", type: 705 },
      { value: null, type: 705 },
    ],
  ])
})

it("sends a statement without parameters with the extended protocol", async () => {
  const { driver, options } = createFakeClient()

  await driver.execute(createStatement("SELECT 1"))

  expect(options).toEqual([{ simple: false }])
})

it("executes a script with the simple protocol, which takes several statements", async () => {
  const { driver, sent, scripts } = createFakeClient()

  await driver.executeScript("CREATE TABLE a (id integer); CREATE TABLE b (id integer)")

  expect(scripts).toEqual(["CREATE TABLE a (id integer); CREATE TABLE b (id integer)"])
  expect(sent).toEqual([])
})

it("reports that it closes a reserved connection", () => {
  const { driver } = createFakeClient()

  expect(driver.closesReservedConnections).toBe(true)
})

describe("errors", () => {
  it("rejects a statement and a script that PostgreSQL rejected with QueryError of the code and constraint_name of the error", async () => {
    const failure = Object.assign(new Error("duplicate key"), {
      severity: "ERROR",
      severity_local: "ОШИБКА",
      code: "23505",
      constraint_name: "form_pkey",
    })
    const { driver } = createFakeClient({ failure })

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
    const { driver } = createFakeClient({ failure })

    await expect(driver.execute(createStatement("SELECT 1"))).rejects.toBeInstanceOf(
      ConnectionError,
    )
  })

  it("rejects a failure of the client with ConnectionError", async () => {
    const failure = Object.assign(new Error("write CONNECTION_CLOSED"), {
      code: "CONNECTION_CLOSED",
    })
    const { driver } = createFakeClient({ failure })

    const error = await driver.execute(createStatement("SELECT 1")).catch((error: unknown) => error)

    expect(error).toBeInstanceOf(ConnectionError)
    expect(error).toMatchObject({ cause: failure })
  })

  it("rejects a failure to reserve a connection with ConnectionError whatever its fields", async () => {
    const reserveFailure = Object.assign(new Error("relation does not exist"), {
      severity: "ERROR",
      code: "42P01",
    })
    const { driver } = createFakeClient({ reserveFailure })

    const error = await driver.acquire().catch((error: unknown) => error)

    expect(error).toBeInstanceOf(ConnectionError)
    expect(error).toMatchObject({ cause: reserveFailure })
  })

  it("rejects acquiring a connection, a statement, and a script with ConnectionError after closing starts", async () => {
    const { driver } = createFakeClient()

    const closing = driver.close()

    const errors = await Promise.all(
      [
        driver.acquire(),
        driver.execute(createStatement("SELECT 1")),
        driver.executeScript("SELECT 1"),
      ].map(operation => operation.catch((error: unknown) => error)),
    )
    for (const error of errors) {
      expect(error).toBeInstanceOf(ConnectionError)
    }
    expect(errors.map(error => (error as Error).message)).toEqual([
      "Cannot acquire a connection: the driver is closed",
      "Cannot execute a statement: the driver is closed",
      "Cannot execute a script: the driver is closed",
    ])
    await closing
  })
})
