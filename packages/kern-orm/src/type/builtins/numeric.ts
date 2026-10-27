import { orderingOperators } from "../../expression/operators/ordering"
import { defineType } from "../type"
import { formatTypeName } from "../type-name"

function defineNumberType(sqlType: string) {
  return defineType({ sqlType })
    .transform({ decode: Number, encode: (value: number) => String(value) })
    .withOperators(orderingOperators)
}

/** 2-byte integer as a `number`. */
export const smallint = /* @__PURE__ */ defineNumberType("smallint")

/** 4-byte integer as a `number`. */
export const integer = /* @__PURE__ */ defineNumberType("integer")

/** 8-byte integer as a `bigint`, which keeps values beyond `Number.MAX_SAFE_INTEGER`; accepts a `number` too. */
export const bigint = /* @__PURE__ */ defineType({ sqlType: "bigint" })
  .transform({ decode: BigInt, encode: (value: bigint | number) => String(value) })
  .withOperators(orderingOperators)

/** 4-byte floating-point number as a `number`. */
export const real = /* @__PURE__ */ defineNumberType("real")

/** 8-byte floating-point number as a `number`. */
export const doublePrecision = /* @__PURE__ */ defineNumberType("double precision")

/** Exact number as a decimal string, so that no precision is lost; `numeric.with(precision, scale)` constrains it. */
export const numeric = /* @__PURE__ */ defineType({ sqlType: "numeric" })
  .transform({ decode: value => value, encode: (value: string | number | bigint) => String(value) })
  .withOperators(orderingOperators)
  .withParameters((precision: number, scale?: number) =>
    formatTypeName("numeric", precision, scale),
  )
