import { describe, expectTypeOf, test } from "bun:test"

import type { Codec, CodecInput, CodecOutput, DerivableCodec } from "./codec"
import { defineCodec, isCodec } from "./codec"

const text = defineCodec({ sqlType: "text" })
const numeric = defineCodec({ sqlType: "numeric" }).withParameters(
  (precision: number, scale?: number) => `numeric(${precision},${scale ?? 0})`,
)
const timestamptz = defineCodec({ sqlType: "timestamptz" }).transform({
  decode: value => value,
  encode: (value: string | Date) => (value instanceof Date ? value.toISOString() : value),
})
// The values are `unknown`, which includes a JSON `null` value, and the accepted values are those other than `null`.
const jsonb = defineCodec({ sqlType: "jsonb" }).transform<{}, {}>({
  decode: value => JSON.parse(value),
  encode: value => JSON.stringify(value),
}) as DerivableCodec<unknown, {}>

describe("defineCodec", () => {
  test("defines a codec of strings", () => {
    expectTypeOf(text).toEqualTypeOf<DerivableCodec<string>>()
    expectTypeOf<CodecOutput<typeof text>>().toEqualTypeOf<string>()
    expectTypeOf<CodecInput<typeof text>>().toEqualTypeOf<string>()
  })

  test("rejects a codec, also typed by its contract alone", () => {
    // @ts-expect-error A codec is not options of a codec.
    defineCodec(timestamptz)
    const contract: Codec<string> = text
    // @ts-expect-error A codec is not options of a codec.
    defineCodec(contract)
  })
})

describe("Codec", () => {
  test("is the contract of a derivable codec", () => {
    expectTypeOf(text).toExtend<Codec<string>>()
    expectTypeOf(timestamptz).toExtend<Codec<string, string | Date>>()
    expectTypeOf(numeric.with(10, 2).nullable()).toExtend<Codec<string | null>>()
  })

  test("reads the values of a codec passed as the contract", () => {
    function encodeAndDecode<Output, Input>(
      codec: Codec<Output, Input>,
      value: NonNullable<Input>,
    ) {
      return codec.decode(codec.encode(value))
    }

    expectTypeOf(encodeAndDecode(timestamptz, new Date())).toEqualTypeOf<string>()
    expectTypeOf(encodeAndDecode(text.nullable(), "a")).toEqualTypeOf<string>()
    // @ts-expect-error `text` accepts no number.
    encodeAndDecode(text, 1)
  })

  test("is not a codec of more accepted values", () => {
    // @ts-expect-error The encoder of `text` takes no number.
    const wide: Codec<string, string | number> = text
    void wide
  })

  test("is not a codec of other returned values", () => {
    // @ts-expect-error `text` returns strings.
    const numbers: Codec<number, string> = text
    void numbers
  })
})

describe("transform", () => {
  test("changes the values that the codec returns and accepts", () => {
    const cents = numeric.transform({
      decode: value => BigInt(value),
      encode: (value: bigint) => String(value),
    })
    expectTypeOf<CodecOutput<typeof cents>>().toEqualTypeOf<bigint>()
    expectTypeOf<CodecInput<typeof cents>>().toEqualTypeOf<bigint>()
    expectTypeOf(cents.decode("1")).toEqualTypeOf<bigint>()
  })

  test("without `encode` accepts the values of the original codec", () => {
    const date = timestamptz.transform({ decode: value => new Date(value) })
    expectTypeOf<CodecOutput<typeof date>>().toEqualTypeOf<Date>()
    expectTypeOf<CodecInput<typeof date>>().toEqualTypeOf<string | Date>()

    // @ts-expect-error Without `encode`, a transformed codec accepts the values of the original codec.
    text.transform<number, number>({ decode: Number })
  })

  test("passes non-null values to `decode`", () => {
    text.nullable().transform({
      decode: value => {
        expectTypeOf(value).toEqualTypeOf<string>()
        return value
      },
    })
    // @ts-expect-error `decode` receives the values of the codec.
    text.nullable().transform({ decode: (value: number) => value })
  })

  test("passes undefined that an earlier decoder returns to `decode`", () => {
    const optional = text.nullable().transform({
      decode: value => (value === "" ? undefined : value),
    })
    expectTypeOf(optional.decode("")).toEqualTypeOf<string | undefined>()

    optional.transform({ decode: value => value?.toUpperCase() ?? "" })
    // @ts-expect-error `decode` can receive undefined from an earlier decoder.
    optional.transform({ decode: value => value.toUpperCase() })
    optional.transform({ decode: value => value ?? "", encode: (value: string) => value })
    // @ts-expect-error `decode` can receive undefined from an earlier decoder, also with `encode`.
    optional.transform({ decode: value => value.toUpperCase(), encode: (value: string) => value })
  })

  test("decodes to values other than null, which stands for NULL", () => {
    // @ts-expect-error `decode` cannot return null.
    text.transform({ decode: value => (value === "missing" ? null : value) })
    // @ts-expect-error `decode` cannot return null, also with `encode`.
    text.transform({ decode: (): string | null => null, encode: (value: string) => value })
    text.transform({ decode: value => (value === "missing" ? undefined : value) })
  })

  test("keeps the nullability of the original codec, also of values that include null", () => {
    class Wrapper {
      constructor(readonly value: unknown) {}
    }
    const wrapped = jsonb.transform({
      decode: value => new Wrapper(value),
      encode: (wrapper: Wrapper) => wrapper.value as {},
    })
    expectTypeOf<CodecOutput<typeof wrapped>>().toEqualTypeOf<Wrapper>()
    const nullable = jsonb.nullable().transform({ decode: value => new Wrapper(value) })
    expectTypeOf<CodecOutput<typeof nullable>>().toEqualTypeOf<Wrapper | null>()
    expectTypeOf<CodecInput<typeof nullable>>().toEqualTypeOf<{} | null>()
  })

  test("makes a codec nullable whose `encode` takes null, also as unknown", () => {
    const optional = text.transform({
      decode: value => value,
      encode: (value: string | null) => value ?? "",
    })
    expectTypeOf<CodecOutput<typeof optional>>().toEqualTypeOf<string | null>()
    const anything = text.transform({
      decode: value => value,
      encode: (value: unknown) => String(value),
    })
    expectTypeOf<CodecOutput<typeof anything>>().toEqualTypeOf<string | null>()
    const length = anything.transform({ decode: value => value.length })
    expectTypeOf<CodecOutput<typeof length>>().toEqualTypeOf<number | null>()
  })
})

describe("nullable", () => {
  test("adds null to the values that the codec returns and accepts", () => {
    const nullable = timestamptz.nullable()
    expectTypeOf<CodecOutput<typeof nullable>>().toEqualTypeOf<string | null>()
    expectTypeOf<CodecInput<typeof nullable>>().toEqualTypeOf<string | Date | null>()
  })

  test("keeps the values that `decode` returns and `encode` takes other than null", () => {
    const nullable = text.nullable()
    expectTypeOf(nullable.decode("a")).toEqualTypeOf<string>()
    // @ts-expect-error `encode` takes a value other than null.
    nullable.encode(null)
  })
})

describe("of", () => {
  type FieldType = "text" | "email" | "choice"

  test("narrows the values that the codec returns and accepts", () => {
    const narrowed = text.of<FieldType>()
    expectTypeOf<CodecOutput<typeof narrowed>>().toEqualTypeOf<FieldType>()
    expectTypeOf<CodecInput<typeof narrowed>>().toEqualTypeOf<FieldType>()
  })

  test("keeps `null` of a nullable codec apart from the narrowed values", () => {
    const narrowed = text.nullable().of<"a">()
    expectTypeOf<CodecOutput<typeof narrowed>>().toEqualTypeOf<"a" | null>()
    expectTypeOf<CodecInput<typeof narrowed>>().toEqualTypeOf<"a" | null>()

    type Options = { choices: string[] }
    const optionsAfter = jsonb.nullable().of<Options>()
    expectTypeOf<CodecOutput<typeof optionsAfter>>().toEqualTypeOf<Options | null>()
    expectTypeOf<CodecInput<typeof optionsAfter>>().toEqualTypeOf<Options | null>()
    const optionsBefore = jsonb.of<Options>().nullable()
    expectTypeOf<CodecOutput<typeof optionsBefore>>().toEqualTypeOf<Options | null>()

    const anything = text
      .transform({
        decode: value => value,
        encode: (value: unknown) => String(value),
      })
      .of<"a">()
    expectTypeOf<CodecOutput<typeof anything>>().toEqualTypeOf<"a" | null>()
    expectTypeOf<CodecInput<typeof anything>>().toEqualTypeOf<"a" | null>()

    // @ts-expect-error `nullable` adds `null`, which the narrowed values leave out.
    text.of<"a" | null>()
  })

  test("keeps type parameters", () => {
    numeric.of<"1" | "2">().with(10)
    numeric.with(10).of<"1" | "2">()
  })

  test("takes only values that the codec returns and accepts", () => {
    // @ts-expect-error The narrowed values are values of the codec.
    text.of<1>()

    const dated = timestamptz.transform({ decode: value => new Date(value) })
    expectTypeOf<CodecInput<ReturnType<typeof dated.of<Date>>>>().toEqualTypeOf<Date>()

    const overlapping = jsonb.transform({
      decode: value => value as { value: string | number },
      encode: (value: { value: string | boolean }) => value,
    })
    overlapping.of<{ value: string }>()
    // @ts-expect-error A narrowed value is also accepted.
    overlapping.of<{ value: number }>()

    const length = text.transform({ decode: value => value.length })
    // @ts-expect-error A codec that decodes text into numbers without `encode` accepts no number.
    length.of<1>()
  })
})

describe("with", () => {
  test("is available on a codec with PostgreSQL type parameters", () => {
    expectTypeOf(numeric.with(10, 2)).toEqualTypeOf(numeric)
    numeric.nullable().with(10)

    // @ts-expect-error Only a codec with PostgreSQL type parameters has `with`.
    text.with(10)
  })

  test("takes parameters typed by the codec", () => {
    // @ts-expect-error Type parameters are typed by the codec.
    numeric.with("10")
  })
})

describe("isCodec", () => {
  test("narrows a value to a codec of any values", () => {
    const value: unknown = text
    if (isCodec(value)) {
      expectTypeOf(value.castType).toEqualTypeOf<string>()
      expectTypeOf(value.decode).returns.toBeAny()
    }
  })
})
