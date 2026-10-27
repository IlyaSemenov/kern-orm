import { describe, expect, it } from "bun:test"

import { array } from "./builtins/array"
import { timestamptz } from "./builtins/datetime"
import { enumOf } from "./builtins/enum"
import { numeric } from "./builtins/numeric"
import { char, varchar } from "./builtins/text"
import { defineType } from "./type"

describe("type parameters", () => {
  it("create a type with parameters, keeping the type without them", () => {
    expect(varchar.sqlType).toBe("varchar")
    expect(varchar.with(255).sqlType).toBe("varchar(255)")
    expect(numeric.with(10, 2).sqlType).toBe("numeric(10,2)")
  })

  it("keep the other changes of the type", () => {
    const amount = numeric.transform({ decode: Number }).nullable().with(10, 2)

    expect(amount.sqlType).toBe("numeric(10,2)")
    expect(amount.decode("12.50")).toBe(12.5)
    expect(amount.isNullable).toBe(true)
  })

  it("keep the cast type without them", () => {
    expect(numeric.with(10, 2).castType).toBe("numeric")
    expect(char.with(3).castType).toBe("bpchar")
    expect(array(varchar.with(255)).castType).toBe("varchar[]")
    expect(array(varchar.with(255)).sqlType).toBe("varchar(255)[]")
  })

  it("are rejected in the SQL type name without a cast type", () => {
    expect(() => defineType({ sqlType: "vector(3)" })).toThrow("withParameters")
    expect(defineType({ sqlType: "vector(3)", castType: "vector" }).castType).toBe("vector")
    expect(enumOf('"status(v2)"', ["draft"]).castType).toBe('"status(v2)"')
  })

  it("format the SQL type of a custom type", () => {
    const vector = defineType({ sqlType: "vector" }).withParameters(
      (dimensions: number) => `vector(${dimensions})`,
    )

    expect(vector.with(1536).sqlType).toBe("vector(1536)")
  })
})

describe("transform", () => {
  it("decodes values of the type into another representation", () => {
    expect(numeric.with(10, 2).transform({ decode: Number }).decode("12.50")).toBe(12.5)
    expect(
      timestamptz.transform({ decode: value => new Date(value) }).decode("2026-01-15 14:00:00+07"),
    ).toEqual(new Date("2026-01-15T07:00:00Z"))
  })

  it("encodes the representation through the type", () => {
    const cents = numeric.with(12, 0).transform({
      decode: value => BigInt(value),
      encode: (value: bigint) => value * 100n,
    })
    expect(cents.encode(5n)).toBe("500")
  })

  it("chains, decoding in call order and encoding in reverse", () => {
    const cents = numeric
      .with(10, 2)
      .transform({ decode: Number })
      .transform({ decode: value => value * 100, encode: (value: number) => value / 100 })

    expect(cents.decode("12.50")).toBe(1250)
    expect(cents.encode(1250)).toBe("12.5")
  })

  it("keeps the SQL type and operators", () => {
    const decimal = numeric.with(10, 2).transform({ decode: Number })
    expect(decimal.sqlType).toBe("numeric(10,2)")
    expect(Object.keys(decimal.operators)).toEqual(["eq", "ne", "in", "lt", "lte", "gt", "gte"])
  })
})
