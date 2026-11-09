import { expect, it } from "bun:test"

import { createStatement } from "kern-orm"
import type { Sql } from "postgres"

import { postgresJsDriver } from "./driver"

/** Fake postgres.js client that records the parameters and options of its statements and the scripts of the simple protocol, and answers them with no rows. */
function createFakeClient() {
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
    reserve: () => Promise.resolve({ release() {} }),
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

it("rejects acquiring a connection after closing starts", async () => {
  const { driver } = createFakeClient()

  const closing = driver.close()

  await expect(driver.acquire()).rejects.toThrow(
    "Cannot acquire a connection: the driver is closed",
  )
  await closing
})
