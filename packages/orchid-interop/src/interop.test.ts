import { expect, test } from "bun:test"

import { Adapter as PostgresJsAdapter } from "orchid-orm/postgres-js"
import type { Sql } from "postgres"

import { createOrchidInterop } from "./interop"

test.each([
  { option: "schema", value: "public", message: "connection.schema; use orchid.schema" },
  {
    option: "setConfig",
    value: { statement_timeout: "1000" },
    message: "connection.setConfig; set the settings in connection.connection",
  },
  { option: "connectRetry", value: true, message: "connection.connectRetry" },
  { option: "types", value: {}, message: "connection.types" },
])(
  "rejects the connection option $option before it opens a pool",
  async ({ option, value, message }) => {
    const configure = PostgresJsAdapter.configure
    PostgresJsAdapter.configure = () => {
      throw new Error("configured a pool")
    }
    let rejection: Promise<unknown>
    try {
      // createOrchidInterop checks the options and configures the client before its first await.
      rejection = createOrchidInterop({ connection: { [option]: value } }, {})
    } finally {
      PostgresJsAdapter.configure = configure
    }
    await expect(rejection).rejects.toEqual(
      new TypeError(`The Kern Orchid adapter does not support ${message}`),
    )
  },
)

test("keeps the error of a failed initialization when closing the pool fails too", async () => {
  const configure = PostgresJsAdapter.configure
  const initialization = new Error("startup query failed")
  const cleanup = new Error("end failed")
  // The client never connects: its startup query and its end fail with the errors of the test.
  PostgresJsAdapter.configure = options => {
    const client = configure(options) as Sql
    client.unsafe = (() => ({ execute: () => Promise.reject(initialization) })) as never
    client.end = () => Promise.reject(cleanup)
    return client
  }
  let rejection: Promise<unknown>
  try {
    // createOrchidInterop configures the client before its first await.
    rejection = createOrchidInterop({ connection: {} }, {}).then(
      () => undefined,
      (error: unknown) => error,
    )
  } finally {
    PostgresJsAdapter.configure = configure
  }
  const error = await rejection
  expect(error).toBeInstanceOf(SuppressedError)
  expect((error as SuppressedError).error).toBe(cleanup)
  expect((error as SuppressedError).suppressed).toBe(initialization)
})
