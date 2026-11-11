import { defineCodec } from "../codec/codec"
import { formatTypeName } from "../codec/type-name"

/** 2-byte integer as a `number`. */
export const smallint = /* @__PURE__ */ defineNumberCodec("smallint")

/** 4-byte integer as a `number`. */
export const integer = /* @__PURE__ */ defineNumberCodec("integer")

/** 8-byte integer as a `bigint`, which keeps values beyond `Number.MAX_SAFE_INTEGER`; accepts a `number` too. */
export const bigint = /* @__PURE__ */ defineCodec({ sqlType: "bigint" }).transform({
  decode: BigInt,
  encode: (value: bigint | number) => String(value),
})

/** 4-byte floating-point number as a `number`. */
export const real = /* @__PURE__ */ defineNumberCodec("real")

/** 8-byte floating-point number as a `number`. */
export const doublePrecision = /* @__PURE__ */ defineNumberCodec("double precision")

/** Exact number as a decimal string, so that no precision is lost; `numeric.with(precision, scale)` constrains it. */
export const numeric = /* @__PURE__ */ defineCodec({ sqlType: "numeric" })
  .transform({ decode: value => value, encode: (value: string | number | bigint) => String(value) })
  .withParameters((precision: number, scale?: number) =>
    formatTypeName("numeric", precision, scale),
  )

/** Defines a codec of a PostgreSQL type of numbers whose values are JavaScript numbers. */
function defineNumberCodec(sqlType: string) {
  return defineCodec({ sqlType }).transform({
    decode: Number,
    encode: (value: number) => String(value),
  })
}
