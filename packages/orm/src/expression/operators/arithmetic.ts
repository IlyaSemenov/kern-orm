import type { AnyExpression, Expression } from "../expression"
import { getType } from "../expression"

import { applyBinaryOperator } from "./binary"
import type { Operand, OperandValue } from "./comparison"
import type { GenericOperator, OperatorSignature } from "./generic"
import { defineGenericOperator } from "./generic"

/**
 * Value of the result of arithmetic on values `T`: the number, bigint, or string that a literal of `T` widens to, and `T` itself otherwise, such as a value of `transform`.
 *
 * A result is not one of the literals that `of` narrowed the values to, so it widens them, which also drops a brand of a primitive.
 */
export type ArithmeticValue<T> = T extends number
  ? number
  : T extends bigint
    ? bigint
    : T extends string
      ? string
      : T

/** Result of arithmetic on values `T` with an operand of values `V`: the widened values of `T`, with `undefined` that a decoder of `transform` returns, and `NULL` when either can be. */
export type ArithmeticResult<T, V> =
  | ArithmeticValue<Exclude<T, null>>
  | (null extends T | V ? null : never)

/** Signature of `add`, `sub`, `mul`, `div`, and `mod`: an expression of the type of the expression they are called on, which decodes the result and gives it its operators. */
export interface ArithmeticSignature extends OperatorSignature {
  readonly method: <V extends Operand<ArithmeticValue<this["T"]>, ArithmeticValue<this["I"]>>>(
    value: V,
  ) => Expression<
    ArithmeticResult<this["T"], OperandValue<V>>,
    this["O"],
    ArithmeticValue<this["I"]>
  >
}

/** Values of the types that arithmetic operators can be added to: numbers, bigints, and decimal strings, such as of `numeric`. */
type ArithmeticExpression = AnyExpression<number | bigint | string | null>

/** Operator of `arithmeticOperators` and `exactArithmeticOperators`. */
export type ArithmeticOperator = GenericOperator<ArithmeticSignature, ArithmeticExpression>

/** Operators of `arithmeticOperators`. */
export type ArithmeticOperators = {
  add: ArithmeticOperator
  sub: ArithmeticOperator
  mul: ArithmeticOperator
  div: ArithmeticOperator
}

/** Operators of `exactArithmeticOperators`. */
export type ExactArithmeticOperators = ArithmeticOperators & {
  mod: ArithmeticOperator
}

/**
 * Operators of number types: `add`, `sub`, `mul`, and `div`, the SQL `+`, `-`, `*`, and `/` of the expression with an operand of its type.
 *
 * The result has the type of the expression they are called on, which decodes it and gives it its operators; PostgreSQL computes it in the type of its operands, so dividing integers truncates the quotient.
 */
export const arithmeticOperators: ArithmeticOperators = {
  add: /* @__PURE__ */ createArithmetic("+"),
  sub: /* @__PURE__ */ createArithmetic("-"),
  mul: /* @__PURE__ */ createArithmetic("*"),
  div: /* @__PURE__ */ createArithmetic("/"),
}

/** Operators of integer types and `numeric`: those of `arithmeticOperators`, and `mod`, the SQL `%` remainder, which PostgreSQL lacks for floating-point types. */
export const exactArithmeticOperators: ExactArithmeticOperators = {
  ...arithmeticOperators,
  mod: /* @__PURE__ */ createArithmetic("%"),
}

function createArithmetic(operator: string) {
  return defineGenericOperator<ArithmeticSignature, ArithmeticExpression>(
    (self, value) => applyBinaryOperator(self, operator, value, getType(self)) as never,
  )
}
