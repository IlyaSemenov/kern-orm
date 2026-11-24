import { expect, it } from "bun:test"

import { getThrownError } from "@kern-orm/test-harness/errors"

import { decodeBytea, encodeBytea } from "./bytea"

it("round-trips bytea in hex", () => {
  const bytes = new Uint8Array([0, 1, 254, 255])
  expect(encodeBytea(bytes)).toBe("\\x0001feff")
  expect(decodeBytea(encodeBytea(bytes))).toEqual(bytes)
})

it("rejects a literal with an odd number of hex digits", () => {
  expect(getThrownError(() => decodeBytea("\\x0"))).toEqual(
    new Error("Unsupported bytea value: it has an odd number of hex digits"),
  )
})
