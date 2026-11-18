import { doublePrecision } from "../../type/builtins/numeric"
import type { NumberTypeOperators } from "../../type/number"
import type { Expression } from "../expression"

import { applyBinaryOperator } from "./binary"
import type { Operand, OperandValue } from "./comparison"
import type { GenericOperator, OperatorSignature } from "./generic"
import { defineGenericOperator } from "./generic"

/** Signature of the distances of `vectorOperators`: an expression of `double precision`, which is `NULL` when the expression or the operand can be. */
export interface DistanceSignature extends OperatorSignature {
  readonly method: <V extends Operand<this["T"], this["I"]>>(
    value: V,
  ) => Expression<
    number | (null extends this["T"] | OperandValue<V> ? null : never),
    NumberTypeOperators
  >
}

/** Operator of `vectorOperators`. */
export type DistanceOperator = GenericOperator<DistanceSignature>

/** Operators of `vectorOperators`. */
export type VectorOperators = {
  l2Distance: DistanceOperator
  negativeInnerProduct: DistanceOperator
  cosineDistance: DistanceOperator
  l1Distance: DistanceOperator
}

/**
 * Operators of the vector types of pgvector: the distances of the expression to an operand of its type, `l2Distance`, `negativeInnerProduct`, `cosineDistance`, and `l1Distance`, the SQL `<->`, `<#>`, `<=>`, and `<+>`.
 *
 * `negativeInnerProduct` is the inner product with its sign changed, as pgvector gives it, so that the most similar vectors come first in ascending order.
 * The operators are written as they are, so that `ORDER BY` of a distance can use an index of pgvector.
 */
export const vectorOperators: VectorOperators = {
  l2Distance: /* @__PURE__ */ createDistance("<->"),
  negativeInnerProduct: /* @__PURE__ */ createDistance("<#>"),
  cosineDistance: /* @__PURE__ */ createDistance("<=>"),
  l1Distance: /* @__PURE__ */ createDistance("<+>"),
}

function createDistance(operator: string) {
  return defineGenericOperator<DistanceSignature>(
    (self, value) => applyBinaryOperator(self, operator, value, doublePrecision) as never,
  )
}
