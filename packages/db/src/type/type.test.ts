import { describe, expect, it } from "bun:test"

import { defineType, isType } from "./type"

const vector = defineType({ sqlType: "vector" })
  .transform({
    decode: text => JSON.parse(text) as number[],
    encode: (value: number[]) => JSON.stringify(value),
  })
  .withParameters((dimensions: number) => `vector(${dimensions})`)

describe("defineType", () => {
  it("defines a type of the text representations as they are", () => {
    const ltree = defineType({ sqlType: "ltree" })

    expect(ltree.sqlType).toBe("ltree")
    expect(ltree.castType).toBe("ltree")
    expect(ltree.isNullable).toBe(false)
    expect(ltree.encode("a.b")).toBe("a.b")
    expect(ltree.decode("a.b")).toBe("a.b")
  })

  it("rejects type parameters in the SQL type name without a cast type", () => {
    expect(() => defineType({ sqlType: "vector(3)" })).toThrow("withParameters")
    expect(defineType({ sqlType: "vector(3)", castType: "vector" }).castType).toBe("vector")
  })

  it("rejects a type, which would lose its conversion and nullability", () => {
    // @ts-expect-error A type is not options of a type.
    expect(() => defineType(vector.nullable())).toThrow(
      "defineType() of kern-db takes options, not a type",
    )
  })

  it("creates a type that cannot be changed", () => {
    expect(Object.isFrozen(defineType({ sqlType: "ltree" }))).toBe(true)
  })
})

describe("type parameters", () => {
  it("create a type with parameters, keeping the type without them", () => {
    expect(vector.with(1536).sqlType).toBe("vector(1536)")
    expect(vector.sqlType).toBe("vector")
  })

  it("keep the cast type without them", () => {
    expect(vector.with(1536).castType).toBe("vector")
  })

  it("keep the other changes of the type", () => {
    const embedding = vector
      .transform({ decode: value => value.length })
      .nullable()
      .with(3)

    expect(embedding.sqlType).toBe("vector(3)")
    expect(embedding.decode("[1,2,3]")).toBe(3)
    expect(embedding.isNullable).toBe(true)
  })

  it("apply again to a type that has them", () => {
    expect(vector.with(3).with(1536).sqlType).toBe("vector(1536)")
  })

  it("give only a type of withParameters the method with", () => {
    expect("with" in defineType({ sqlType: "ltree" })).toBe(false)
    expect("with" in vector.nullable()).toBe(true)
  })
})

describe("transform", () => {
  const numeric = defineType({ sqlType: "numeric" })

  it("decodes values of the type into another representation", () => {
    expect(numeric.transform({ decode: Number }).decode("12.50")).toBe(12.5)
  })

  it("keeps the encoder of the type without one of its own", () => {
    expect(numeric.transform({ decode: Number }).encode).toBe(numeric.encode)
  })

  it("encodes the representation through the type", () => {
    const cents = numeric
      .transform({ decode: value => BigInt(value), encode: (value: bigint) => String(value) })
      .transform({ decode: value => value / 100n, encode: (value: bigint) => value * 100n })

    expect(cents.encode(5n)).toBe("500")
  })

  it("chains, decoding in call order and encoding in reverse", () => {
    const cents = numeric
      .transform({ decode: Number, encode: (value: number) => String(value) })
      .transform({ decode: value => value * 100, encode: (value: number) => value / 100 })

    expect(cents.decode("12.50")).toBe(1250)
    expect(cents.encode(1250)).toBe("12.5")
  })

  it("encodes and decodes by functions taken from the type", () => {
    const { decode, encode } = numeric
      .transform({ decode: Number, encode: (value: number) => String(value) })
      .transform({ decode: value => value * 100, encode: (value: number) => value / 100 })

    expect(decode("12.50")).toBe(1250)
    expect(encode(1250)).toBe("12.5")
  })

  it("keeps the SQL type and nullability", () => {
    const amount = numeric.nullable().transform({ decode: Number })

    expect(amount.sqlType).toBe("numeric")
    expect(amount.castType).toBe("numeric")
    expect(amount.isNullable).toBe(true)
  })
})

describe("nullable", () => {
  it("creates a nullable type, keeping the type it is called on", () => {
    const ltree = defineType({ sqlType: "ltree" })

    expect(ltree.nullable().isNullable).toBe(true)
    expect(ltree.isNullable).toBe(false)
  })
})

describe("of", () => {
  it("narrows the values only in types, keeping the type", () => {
    const ltree = defineType({ sqlType: "ltree" })

    expect<unknown>(ltree.of<"a" | "b">()).toBe(ltree)
  })
})

describe("isType", () => {
  it("takes a type and a type derived from it", () => {
    expect(isType(vector)).toBe(true)
    expect(isType(vector.with(3).nullable())).toBe(true)
  })

  it("takes an object that copies the members of a type", () => {
    const extended = { ...vector, operators: {} }

    expect(isType(extended)).toBe(true)
    expect(extended.encode([1, 2])).toBe("[1,2]")
  })

  it("rejects an object with the same members that copies no type", () => {
    const lookalike = {
      sqlType: "ltree",
      castType: "ltree",
      isNullable: false,
      encode: (value: string) => value,
      decode: (text: string) => text,
    }

    expect(isType(lookalike)).toBe(false)
    expect(isType({ type: vector })).toBe(false)
    expect(isType(null)).toBe(false)
    expect(isType("vector")).toBe(false)
  })
})
