import { expect, it } from "bun:test"

import { getThrownError } from "@kern-orm/test-harness/errors"

import { decodeBytea, encodeBytea } from "./bytea"

it("round-trips bytea in hex", () => {
  const bytes = new Uint8Array([0, 1, 254, 255])
  expect(encodeBytea(bytes)).toBe("\\x0001feff")
  expect(decodeBytea(encodeBytea(bytes))).toEqual(bytes)
})

it("encodes only the bytes of a view", () => {
  expect(encodeBytea(new Uint8Array([9, 0, 1, 9]).subarray(1, 3))).toBe("\\x0001")
})

it("encodes bytes whose own toHex returns other digits", () => {
  const bytes = Object.assign(new Uint8Array([255]), { toHex: () => "00" })
  expect(encodeBytea(bytes)).toBe("\\xff")
})

it("decodes hex digits in either case", () => {
  expect(decodeBytea("\\xaBCd")).toEqual(new Uint8Array([0xab, 0xcd]))
})

it("decodes into a plain Uint8Array with a buffer of its own", () => {
  const bytes = decodeBytea("\\x00ff")
  expect(Object.getPrototypeOf(bytes)).toBe(Uint8Array.prototype)
  expect(bytes.buffer.byteLength).toBe(2)
})

it("rejects text with an odd number of hex digits", () => {
  expect(getThrownError(() => decodeBytea("\\x0"))).toEqual(
    new Error("Unsupported bytea value: it has an odd number of hex digits"),
  )
})

it("rejects text that would truncate the decoded value", () => {
  // The class and the message of the error depend on the runtime.
  expect(() => decodeBytea("\\x00zzff")).toThrow()
})
