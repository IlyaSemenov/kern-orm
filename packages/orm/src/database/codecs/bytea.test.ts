import { expect, it } from "bun:test"

import { decodeBytea, encodeBytea } from "./bytea"

it("round-trips bytea in hex", () => {
  const bytes = new Uint8Array([0, 1, 254, 255])
  expect(encodeBytea(bytes)).toBe("\\x0001feff")
  expect(decodeBytea(encodeBytea(bytes))).toEqual(bytes)
})
