import * as codecs from "kern-db/types"

import { orderingOperators } from "../../expression/operators/ordering"
import { defineNumberType, getIntegerType } from "../number"
import { defineType } from "../type"

/** 2-byte integer as a `number`. */
export const smallint = /* @__PURE__ */ defineNumberType(codecs.smallint)

/** 4-byte integer as a `number`. */
export const integer = /* @__PURE__ */ getIntegerType()

/** 8-byte integer as a `bigint`, which keeps values beyond `Number.MAX_SAFE_INTEGER`; accepts a `number` too. */
export const bigint = /* @__PURE__ */ defineType(codecs.bigint).withOperators(orderingOperators)

/** 4-byte floating-point number as a `number`. */
export const real = /* @__PURE__ */ defineNumberType(codecs.real)

/** 8-byte floating-point number as a `number`. */
export const doublePrecision = /* @__PURE__ */ defineNumberType(codecs.doublePrecision)

/** Exact number as a decimal string, so that no precision is lost; `numeric.with(precision, scale)` constrains it. */
export const numeric = /* @__PURE__ */ defineType(codecs.numeric).withOperators(orderingOperators)
