import { afterEach, beforeEach, expect, it } from "bun:test"
import { runInNewContext } from "node:vm"

import type { Connection } from "../driver"

import { releaseConnection } from "./release"
import { settleCallbacks } from "./testing"

const releaseError = new Error("release")

/** Connection whose release throws `releaseError`. */
const failingConnection: Connection = {
  execute: () => Promise.reject(new Error("unused")),
  executeScript: () => Promise.reject(new Error("unused")),
  release() {
    throw releaseError
  },
}

const originalConsoleError = console.error
let logged: unknown[][]

beforeEach(() => {
  logged = []
  console.error = (...values: unknown[]) => logged.push(values)
})

afterEach(() => {
  console.error = originalConsoleError
})

it("passes a failed release to onReleaseError", async () => {
  const reported: unknown[] = []

  await releaseConnection(failingConnection, undefined, error => reported.push(error))

  expect(reported).toEqual([releaseError])
  expect(logged).toEqual([])
})

it("passes a failed release to console.error without onReleaseError", async () => {
  await releaseConnection(failingConnection, undefined, undefined)

  expect(logged).toEqual([["kern-orm: releasing a connection failed", releaseError]])
})

it("passes the error of a throwing onReleaseError and the failed release to console.error", async () => {
  const handlerError = new Error("handler")

  await releaseConnection(failingConnection, undefined, () => {
    throw handlerError
  })

  expect(logged).toEqual([
    ["kern-orm: onReleaseError failed", handlerError],
    ["kern-orm: releasing a connection failed", releaseError],
  ])
})

it("passes the rejection of an async onReleaseError and the failed release to console.error", async () => {
  const handlerError = new Error("handler")

  await releaseConnection(failingConnection, undefined, async () => {
    throw handlerError
  })
  await settleCallbacks()

  expect(logged).toEqual([
    ["kern-orm: onReleaseError failed", handlerError],
    ["kern-orm: releasing a connection failed", releaseError],
  ])
})

it("passes the rejection of an async onReleaseError of another realm and the failed release to console.error", async () => {
  const handlerError = new Error("handler")
  // Jest runs tests in a context of `node:vm`, whose promises fail `instanceof Promise` of the module.
  const handler = runInNewContext("async () => { throw handlerError }", {
    handlerError,
  }) as () => void

  await releaseConnection(failingConnection, undefined, handler)
  await settleCallbacks()

  expect(logged).toEqual([
    ["kern-orm: onReleaseError failed", handlerError],
    ["kern-orm: releasing a connection failed", releaseError],
  ])
})

it("resolves when console.error throws", async () => {
  console.error = () => {
    throw new Error("console")
  }

  await expect(releaseConnection(failingConnection, undefined, undefined)).resolves.toBeUndefined()
})
