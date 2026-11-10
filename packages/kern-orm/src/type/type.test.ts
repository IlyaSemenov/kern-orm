import { describe, expect, it } from "bun:test"

import { defineCodec, isCodec } from "../database/codec/codec"
import { orderingOperators } from "../expression/operators/ordering"
import { sql } from "../expression/sql"

import { timestamptz } from "./builtins/datetime"
import { numeric } from "./builtins/numeric"
import { text, varchar } from "./builtins/text"
import { defineType, describeRejectedCodec, isType } from "./type"

describe("defineType", () => {
  const vectorCodec = defineCodec({ sqlType: "vector" })
    .transform({
      decode: text => JSON.parse(text) as number[],
      encode: (value: number[]) => JSON.stringify(value),
    })
    .withParameters((dimensions: number) => `vector(${dimensions})`)

  it("defines a type of the text representations as they are", () => {
    const ltree = defineType({ sqlType: "ltree" })

    expect(ltree.sqlType).toBe("ltree")
    expect(ltree.castType).toBe("ltree")
    expect(ltree.isNullable).toBe(false)
    expect(ltree.decode(ltree.encode("a.b"))).toBe("a.b")
    expect(ltree.operators).toEqual({})
  })

  it("defines a type from a codec, with its values and type parameters", () => {
    const vector = defineType(vectorCodec)

    expect(vector.sqlType).toBe("vector")
    expect(vector.with(1536).sqlType).toBe("vector(1536)")
    expect(vector.with(1536).castType).toBe("vector")
    expect(vector.with(3).nullable().isNullable).toBe(true)
    expect(vector.decode("[1,2]")).toEqual([1, 2])
    expect(vector.operators).toEqual({})
  })

  it("defines a type from another type, with its values and type parameters and without its operators", () => {
    const plain = defineType(numeric.nullable())

    expect(plain.operators).toEqual({})
    expect(plain.sqlType).toBe("numeric")
    expect(plain.isNullable).toBe(true)
    expect(plain.encode).toBe(numeric.encode)
    expect(plain.with(10, 2).sqlType).toBe("numeric(10,2)")
    expect(plain.with(10, 2).operators).toEqual({})
    expect(plain.transform({ decode: Number }).decode("12.50")).toBe(12.5)
    expect(isType(plain.with(10, 2))).toBe(true)
  })

  it("defines a type that encodes and decodes by the functions of its codec", () => {
    const vector = defineType(vectorCodec).withOperators(orderingOperators)

    expect(vector.encode).toBe(vectorCodec.encode)
    expect(vector.decode).toBe(vectorCodec.decode)
    expect(vector.nullable().with(3).decode).toBe(vectorCodec.decode)
  })

  it("defines a type that is a codec, unlike a column of it", () => {
    const vector = defineType(vectorCodec)

    expect(isCodec(vector)).toBe(true)
    expect(isCodec(vector.withOperators(orderingOperators).with(3).nullable())).toBe(true)
    expect(isCodec(vector.columnName("embedding"))).toBe(false)
  })

  it("defines a type that cannot be changed", () => {
    expect(Object.isFrozen(defineType(vectorCodec))).toBe(true)
    expect(Object.isFrozen(defineType(vectorCodec).nullable())).toBe(true)
  })
})

describe("isType", () => {
  it("takes a type, and neither a codec without operators nor a column", () => {
    const codec = defineCodec({ sqlType: "ltree" })

    expect(isType(defineType(codec))).toBe(true)
    expect(isType(codec)).toBe(false)
    expect(isType(defineType(codec).unique())).toBe(false)
    // @ts-expect-error A codec is not a type.
    expect(() => sql(codec)).toThrow("sql() accepts a type")
  })
})

describe("describeRejectedCodec", () => {
  it("hints defineType for a codec, and describes no value that is not a codec", () => {
    const codec = defineCodec({ sqlType: "ltree" })

    expect(describeRejectedCodec(codec)).toBe(
      "a codec without operators; create a type from it with defineType(codec)",
    )
    expect(describeRejectedCodec(defineType(codec).unique())).toBeUndefined()
    expect(describeRejectedCodec("ltree")).toBeUndefined()
  })
})

describe("operators", () => {
  it("stay the same on a type derived from the type they were added to", () => {
    const amount = numeric.withOperators({
      isZero: self => sql<boolean>`${self} = 0`,
    })
    const { operators } = amount

    expect(Object.isFrozen(operators)).toBe(true)
    expect(amount.nullable().operators).toBe(operators)
    expect(amount.transform({ decode: Number }).operators).toBe(operators)
    expect(amount.with(10, 2).operators).toBe(operators)
    expect(amount.withParameters((precision: number) => `numeric(${precision})`).operators).toBe(
      operators,
    )
    expect(amount.of<"0">().operators).toBe(operators)
  })
})

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
  })

  it("are rejected in the SQL type name without a cast type", () => {
    expect(() => defineType({ sqlType: "vector(3)" })).toThrow("withParameters")
    expect(defineType({ sqlType: "vector(3)", castType: "vector" }).castType).toBe("vector")
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

describe("of", () => {
  it("narrows the values only in types, keeping the type", () => {
    expect<unknown>(text.of<"a" | "b">()).toBe(text)
  })
})
