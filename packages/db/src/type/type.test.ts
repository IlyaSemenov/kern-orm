import { describe, expect, it } from "bun:test"

import { getThrownError } from "@kern-orm/test-harness/errors"

import { decodeNull, defineType, isType } from "./type"

const vector = defineType({ sqlType: "vector" })
  .transform({
    decode: text => JSON.parse(text) as number[],
    encode: (value: number[]) => JSON.stringify(value),
  })
  .withParameters((dimensions: number) => `vector(${dimensions})`)

function readEpoch(value: string): string {
  return `extract(epoch from ${value})`
}

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

  it("defines a type that is read by its read expression, and as it is without one", () => {
    const epoch = defineType({ sqlType: "timestamptz", read: readEpoch })

    expect(epoch.read).toBe(readEpoch)
    expect(epoch.read!('"run_at"')).toBe('extract(epoch from "run_at")')
    expect(defineType({ sqlType: "timestamptz" }).read).toBeUndefined()
  })

  it("rejects a read option that is not a function of SQL text that refers to its value once", () => {
    const error = new TypeError(
      'The read option of type "timestamptz" must be a function that returns the SQL text of an expression that refers to its value once',
    )

    expect(
      // @ts-expect-error The option is a function.
      getThrownError(() => defineType({ sqlType: "timestamptz", read: "extract(epoch from $1)" })),
    ).toEqual(error)
    expect(
      // @ts-expect-error The function returns SQL text.
      getThrownError(() => defineType({ sqlType: "timestamptz", read: value => ({ value }) })),
    ).toEqual(error)
    // The value would be evaluated twice, such as a volatile expression that a query selects.
    expect(
      getThrownError(() =>
        defineType({ sqlType: "timestamptz", read: value => `${value} - ${value}` }),
      ),
    ).toEqual(error)
    expect(
      getThrownError(() =>
        defineType({ sqlType: "timestamptz", read: () => "extract(epoch from value)" }),
      ),
    ).toEqual(error)
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

describe("nullableAs", () => {
  const ltree = defineType({ sqlType: "ltree" })
  const optional = ltree.nullableAs(() => undefined)

  it("creates a nullable type that decodes NULL to the value of the function, and other values as the type does", () => {
    expect(optional.isNullable).toBe(true)
    expect(decodeNull(optional)).toBeUndefined()
    expect(optional.decode("a.b")).toBe("a.b")
    expect(optional.encode("a.b")).toBe("a.b")
  })

  it("leaves a type without it decoding NULL to null", () => {
    expect(ltree.decodeNull).toBeUndefined()
    expect(ltree.nullable().decodeNull).toBeUndefined()
    expect(decodeNull(ltree.nullable())).toBeNull()
    expect(decodeNull(ltree)).toBeNull()
  })

  it("calls the function for each NULL, so that it can return a new object each time", () => {
    const labels = ltree.nullableAs((): string[] => [])

    expect(decodeNull(labels)).toEqual([])
    expect(decodeNull(labels)).not.toBe(decodeNull(labels))
  })

  it("rejects a thenable that the function returns, such as of an async function, when it decodes NULL", () => {
    // @ts-expect-error The function returns its value synchronously.
    const pending = ltree.nullableAs(async () => undefined)

    expect(getThrownError(() => decodeNull(pending))).toEqual(
      new TypeError(
        "The function of nullableAs() must return the value of NULL synchronously, not a Promise or a query",
      ),
    )
  })

  it("applies to a type that is already nullable", () => {
    expect(decodeNull(ltree.nullable().nullableAs(() => false))).toBe(false)
  })

  it("is kept with type parameters", () => {
    const decodeMissing = () => undefined
    const embedding = vector.nullableAs(decodeMissing).with(3)

    expect(embedding.sqlType).toBe("vector(3)")
    expect(embedding.decodeNull).toBe(decodeMissing)
  })

  it("is copied with the members of a type", () => {
    const extended = { ...optional, operators: {} }

    expect(decodeNull(extended)).toBeUndefined()
  })

  it("rejects a later change of the values, whose types would give null for NULL", () => {
    for (const [method, change] of [
      ["transform", () => optional.transform({ decode: value => value?.length })],
      ["of", () => optional.of<"a">()],
      ["nullable", () => optional.nullable()],
    ] as const) {
      expect(getThrownError(change)).toEqual(
        new TypeError(
          `${method}() cannot change a type that decodes NULL to a value, which nullableAs() creates`,
        ),
      )
    }
  })

  it("rejects a second function of NULL", () => {
    expect(getThrownError(() => optional.nullableAs(() => false))).toEqual(
      new TypeError(
        "nullableAs() cannot change a type that decodes NULL to a value; call it once with one function",
      ),
    )
  })

  it("rejects a value that is not a function", () => {
    const error = new TypeError("nullableAs() takes a function that returns the value of NULL")

    // @ts-expect-error The value of NULL is returned by a function.
    expect(getThrownError(() => ltree.nullableAs(undefined))).toEqual(error)
    // @ts-expect-error The value of NULL is returned by a function.
    expect(getThrownError(() => ltree.nullableAs({ decodeNull: () => undefined }))).toEqual(error)
  })
})

describe("of", () => {
  it("narrows the values only in types, keeping the type", () => {
    const ltree = defineType({ sqlType: "ltree" })

    expect<unknown>(ltree.of<"a" | "b">()).toBe(ltree)
  })
})

describe("read expression", () => {
  it("is kept by the types derived from the type", () => {
    const epoch = defineType({ sqlType: "timestamptz", read: readEpoch }).withParameters(
      (precision: number) => `timestamptz(${precision})`,
    )

    expect(epoch.transform({ decode: Number }).read).toBe(readEpoch)
    expect(epoch.nullable().read).toBe(readEpoch)
    expect(epoch.of<"0">().read).toBe(readEpoch)
    expect(epoch.with(3).read).toBe(readEpoch)
  })

  it("is copied with the members of a type", () => {
    const epoch = defineType({ sqlType: "timestamptz", read: readEpoch })

    expect({ ...epoch, operators: {} }.read).toBe(readEpoch)
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
