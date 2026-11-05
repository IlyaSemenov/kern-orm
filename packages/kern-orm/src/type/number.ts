// Text operators import the `integer` type from this module rather than from `builtins/numeric.ts`, which creates it on load: inside the import cycle with expressions, that would run before `orderingOperators` and `defineType` are initialized.

import type { MergeOperators, NoOperators } from "../expression/operators/definitions"
import { orderingOperators } from "../expression/operators/ordering"

import type { Type } from "./type"
import { defineType } from "./type"

/** Operators of the built-in types of numbers: those of `orderingOperators`. */
export type NumberTypeOperators = MergeOperators<NoOperators, typeof orderingOperators>

/** Defines a type of numbers with the operators of the built-in ones. */
export function defineNumberType(sqlType: string) {
  return defineType({ sqlType })
    .transform({ decode: Number, encode: (value: number) => String(value) })
    .withOperators(orderingOperators)
}

let integerType: Type<number, number, NumberTypeOperators> | undefined

/** Returns the shared `integer` type used by built-in expressions and columns. */
export function getIntegerType(): Type<number, number, NumberTypeOperators> {
  integerType ??= defineNumberType("integer")
  return integerType
}
