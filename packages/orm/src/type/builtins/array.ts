import * as codecs from "../../database/codecs/array"
import type { NoOperators, OperatorDefinitions } from "../../expression/operators/definitions"
import type { EqualityOperators, HasEquality } from "../../expression/operators/equality"
import { equalityOperators, hasEquality } from "../../expression/operators/equality"
import type { Type } from "../type"
import { defineType } from "../type"

/**
 * Creates a one-dimensional array type of `element` values.
 *
 * A `NULL` element decodes to `null`; a nullable `element` type, such as `array(text.nullable())`, types such elements.
 * Elements are separated by commas, as in arrays of all built-in types; a custom type with another delimiter, such as `box`, is not supported.
 * An array has `eq`, `ne`, and `in` when its element type has SQL `=`.
 */
export function array<Output, Input, O extends OperatorDefinitions>(
  // oxlint-disable-next-line typescript/no-explicit-any -- element parameters do not apply to arrays
  element: Type<Output, Input, O, any>,
): Type<Output[], Input[], HasEquality<O> extends true ? EqualityOperators : NoOperators> {
  const type = defineType(codecs.array(element))
  // PostgreSQL compares arrays by their elements, so an array has `=` only when its elements do.
  return (hasEquality(element) ? type.withOperators(equalityOperators) : type) as Type<
    Output[],
    Input[],
    HasEquality<O> extends true ? EqualityOperators : NoOperators
  >
}
