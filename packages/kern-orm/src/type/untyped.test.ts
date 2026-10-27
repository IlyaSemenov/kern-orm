import { expect, it } from "bun:test"

import { encodeUntyped } from "./untyped"

it("encodes values by their JavaScript type", () => {
  expect(encodeUntyped(true)).toBe("t")
  expect(encodeUntyped(12n)).toBe("12")
  expect(encodeUntyped(new Date("2026-01-15T07:00:00Z"))).toBe("2026-01-15T07:00:00.000Z")
  expect(encodeUntyped({ a: 1 })).toBe('{"a":1}')
})

it("rejects arrays, whose element types are unknown", () => {
  expect(() => encodeUntyped(["a"])).toThrow("param(type, value)")
})
