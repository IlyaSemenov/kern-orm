// Text operators import the `integer` type from this module rather than from `builtins/numeric.ts`, which creates it on load: inside the import cycle with expressions, that would run before `orderingOperators` and `defineType` are initialized.

import type { DerivableType } from "kern-db"
import * as dbTypes from "kern-db/types"

import type {
  ArithmeticOperators,
  ExactArithmeticOperators,
} from "../expression/operators/arithmetic"
import { arithmeticOperators, exactArithmeticOperators } from "../expression/operators/arithmetic"
import type { MergeOperators, NoOperators } from "../expression/operators/definitions"
import { orderingOperators } from "../expression/operators/ordering"

import type { Type } from "./type"
import { defineType } from "./type"

/** Operators of the built-in floating-point types: those of `orderingOperators` and `arithmeticOperators`. */
export type NumberTypeOperators = MergeOperators<
  MergeOperators<NoOperators, typeof orderingOperators>,
  ArithmeticOperators
>

/** Operators of the built-in integer types and `numeric`: those of `orderingOperators` and `exactArithmeticOperators`. */
export type ExactNumberTypeOperators = MergeOperators<
  MergeOperators<NoOperators, typeof orderingOperators>,
  ExactArithmeticOperators
>

/** Defines a type from a type of kern-db of floating-point numbers with the built-in ordering and arithmetic operators. */
export function defineNumberType(dbType: DerivableType<number>) {
  return defineType(dbType).withOperators(orderingOperators).withOperators(arithmeticOperators)
}

/** Defines a type from a type of kern-db of integers or of exact numbers with the built-in ordering and arithmetic operators, including `mod`. */
export function defineExactNumberType<
  Output extends number | bigint | string,
  Input,
  Parameters extends unknown[] | undefined,
>(dbType: DerivableType<Output, Input, Parameters>) {
  return defineType(dbType).withOperators(orderingOperators).withOperators(exactArithmeticOperators)
}

let integerType: Type<number, number, ExactNumberTypeOperators> | undefined

/** Returns the shared `integer` type used by built-in expressions and columns. */
export function getIntegerType(): Type<number, number, ExactNumberTypeOperators> {
  integerType ??= defineExactNumberType(dbTypes.integer)
  return integerType
}
