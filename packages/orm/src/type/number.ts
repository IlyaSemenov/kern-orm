// Text operators import the `integer` type from this module rather than from `builtins/numeric.ts`, which creates it on load: inside the import cycle with expressions, that would run before `orderingOperators` and `defineType` are initialized.

import type { DerivableType } from "kern-db"
import * as dbTypes from "kern-db/types"

import type { MergeOperators, NoOperators } from "../expression/operators/definitions"
import { orderingOperators } from "../expression/operators/ordering"

import type { Type } from "./type"
import { defineType } from "./type"

/** Operators of the built-in types of numbers: those of `orderingOperators`. */
export type NumberTypeOperators = MergeOperators<NoOperators, typeof orderingOperators>

/** Defines a type from a type of kern-db of numbers with the built-in ordering operators. */
export function defineNumberType(dbType: DerivableType<number>) {
  return defineType(dbType).withOperators(orderingOperators)
}

let integerType: Type<number, number, NumberTypeOperators> | undefined

/** Returns the shared `integer` type used by built-in expressions and columns. */
export function getIntegerType(): Type<number, number, NumberTypeOperators> {
  integerType ??= defineNumberType(dbTypes.integer)
  return integerType
}
