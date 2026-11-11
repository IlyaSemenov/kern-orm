import { describe, expect, it } from "bun:test"

import { defineCodec, isCodec } from "./codec"

const vector = defineCodec({ sqlType: "vector" })
  .transform({
    decode: text => JSON.parse(text) as number[],
    encode: (value: number[]) => JSON.stringify(value),
  })
  .withParameters((dimensions: number) => `vector(${dimensions})`)

describe("defineCodec", () => {
  it("defines a codec of the text representations as they are", () => {
    const ltree = defineCodec({ sqlType: "ltree" })

    expect(ltree.sqlType).toBe("ltree")
    expect(ltree.castType).toBe("ltree")
    expect(ltree.isNullable).toBe(false)
    expect(ltree.encode("a.b")).toBe("a.b")
    expect(ltree.decode("a.b")).toBe("a.b")
  })

  it("rejects type parameters in the SQL type name without a cast type", () => {
    expect(() => defineCodec({ sqlType: "vector(3)" })).toThrow("withParameters")
    expect(defineCodec({ sqlType: "vector(3)", castType: "vector" }).castType).toBe("vector")
  })

  it("rejects a codec, which would lose its conversion and nullability", () => {
    // @ts-expect-error A codec is not options of a codec.
    expect(() => defineCodec(vector.nullable())).toThrow(
      "defineCodec() takes options, not a codec or a type, which is a codec already",
    )
  })

  it("creates a codec that cannot be changed", () => {
    expect(Object.isFrozen(defineCodec({ sqlType: "ltree" }))).toBe(true)
  })
})

describe("type parameters", () => {
  it("create a codec with parameters, keeping the codec without them", () => {
    expect(vector.with(1536).sqlType).toBe("vector(1536)")
    expect(vector.sqlType).toBe("vector")
  })

  it("keep the cast type without them", () => {
    expect(vector.with(1536).castType).toBe("vector")
  })

  it("keep the other changes of the codec", () => {
    const embedding = vector
      .transform({ decode: value => value.length })
      .nullable()
      .with(3)

    expect(embedding.sqlType).toBe("vector(3)")
    expect(embedding.decode("[1,2,3]")).toBe(3)
    expect(embedding.isNullable).toBe(true)
  })

  it("apply again to a codec that has them", () => {
    expect(vector.with(3).with(1536).sqlType).toBe("vector(1536)")
  })

  it("give only a codec of withParameters the method with", () => {
    expect("with" in defineCodec({ sqlType: "ltree" })).toBe(false)
    expect("with" in vector.nullable()).toBe(true)
  })
})

describe("transform", () => {
  const numeric = defineCodec({ sqlType: "numeric" })

  it("decodes values of the codec into another representation", () => {
    expect(numeric.transform({ decode: Number }).decode("12.50")).toBe(12.5)
  })

  it("keeps the encoder of the codec without one of its own", () => {
    expect(numeric.transform({ decode: Number }).encode).toBe(numeric.encode)
  })

  it("encodes the representation through the codec", () => {
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

  it("encodes and decodes by functions taken from the codec", () => {
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
  it("creates a nullable codec, keeping the codec it is called on", () => {
    const ltree = defineCodec({ sqlType: "ltree" })

    expect(ltree.nullable().isNullable).toBe(true)
    expect(ltree.isNullable).toBe(false)
  })
})

describe("of", () => {
  it("narrows the values only in types, keeping the codec", () => {
    const ltree = defineCodec({ sqlType: "ltree" })

    expect<unknown>(ltree.of<"a" | "b">()).toBe(ltree)
  })
})

describe("isCodec", () => {
  it("takes a codec and a codec derived from it", () => {
    expect(isCodec(vector)).toBe(true)
    expect(isCodec(vector.with(3).nullable())).toBe(true)
  })

  it("takes an object that copies the members of a codec", () => {
    const extended = { ...vector, operators: {} }

    expect(isCodec(extended)).toBe(true)
    expect(extended.encode([1, 2])).toBe("[1,2]")
  })

  it("rejects an object with the same members that copies no codec", () => {
    const lookalike = {
      sqlType: "ltree",
      castType: "ltree",
      isNullable: false,
      encode: (value: string) => value,
      decode: (text: string) => text,
    }

    expect(isCodec(lookalike)).toBe(false)
    expect(isCodec({ type: vector })).toBe(false)
    expect(isCodec(null)).toBe(false)
    expect(isCodec("vector")).toBe(false)
  })
})
