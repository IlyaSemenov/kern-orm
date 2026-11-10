import { describe, expect, it } from "bun:test"

import type { TextValue } from "../driver"

import { bindParameter, encodeParameter, isUntypedValue, maxParameters } from "./parameter"

describe("encodeParameter", () => {
  it("encodes a value without a codec by its JavaScript type", () => {
    expect([
      encodeParameter("it's", undefined),
      encodeParameter(1.5, undefined),
      encodeParameter(2n ** 64n, undefined),
      encodeParameter(true, undefined),
      encodeParameter(false, undefined),
      encodeParameter(null, undefined),
      encodeParameter(new Date("2026-01-02T03:04:05.678Z"), undefined),
      encodeParameter(new Uint8Array([0, 255]), undefined),
    ]).toEqual([
      "it's",
      "1.5",
      "18446744073709551616",
      "t",
      "f",
      null,
      "2026-01-02T03:04:05.678Z",
      "\\x00ff",
    ])
  })

  it("rejects a value that a parameter does not take without a codec, naming param", () => {
    const takes =
      "A parameter without a codec takes a string, a number, a bigint, a boolean, null, a Date, or a Uint8Array"
    for (const [value, kind] of [
      [{ name: "Survey" }, "an object"],
      [new Map(), "an object"],
      [[1, 2], "an array"],
      [() => 1, "a function"],
      [Symbol("value"), "a symbol"],
    ] as const) {
      expect(isUntypedValue(value)).toBe(false)
      expect(() => encodeParameter(value, undefined)).toThrow(
        new TypeError(`${takes}, not ${kind}; pass JSON or an array with param()`),
      )
    }
  })

  it("rejects undefined, with a codec and without one", () => {
    const codec = { encode: () => "encoded" } as never

    expect(isUntypedValue(undefined)).toBe(false)
    expect(() => encodeParameter(undefined, undefined)).toThrow(
      new TypeError("Query parameter is undefined; use null for NULL"),
    )
    expect(() => encodeParameter(undefined, codec)).toThrow("Query parameter is undefined")
  })
})

describe("bindParameter", () => {
  it("numbers parameters and rejects more than PostgreSQL takes", () => {
    const parameters: TextValue[] = []

    expect([bindParameter(parameters, "1"), bindParameter(parameters, null)]).toEqual(["$1", "$2"])
    for (let index = 2; index < maxParameters; index++) {
      bindParameter(parameters, "1")
    }
    expect(() => bindParameter(parameters, "1")).toThrow(
      "Statement has more than 65535 parameters, which PostgreSQL does not take; split it into several statements, such as in a transaction",
    )
    expect(parameters).toHaveLength(maxParameters)
  })
})
