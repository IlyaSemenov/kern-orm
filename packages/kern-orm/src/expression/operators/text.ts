import type { ComparisonNode } from "../../ast/nodes"
import type { AnyExpression, Expression } from "../expression"
import { toBooleanExpression, toNode } from "../expression"

import type { BooleanResult, Operand, OperandValue } from "./comparison"
import { compareNodes } from "./comparison"
import type { OperatorSignature } from "./generic"
import { defineGenericOperator } from "./generic"

/** Signature of pattern matching: patterns stay strings even when the text values are transformed. */
export interface PatternSignature extends OperatorSignature {
  readonly method: <V extends Operand<string>>(
    pattern: V,
  ) => Expression<BooleanResult<this["T"] | OperandValue<V>>>
}

/**
 * Operators of text types: pattern matching with `LIKE` and `ILIKE`.
 *
 * A string pattern is sent as it is; `param(type, pattern)` encodes it with a type.
 */
export const textOperators = {
  like: /* @__PURE__ */ createPatternComparison("LIKE"),
  ilike: /* @__PURE__ */ createPatternComparison("ILIKE"),
}

function createPatternComparison(operator: ComparisonNode["operator"]) {
  return defineGenericOperator<PatternSignature, AnyExpression<string | null>>((self, pattern) =>
    toBooleanExpression(
      // Patterns are PostgreSQL text, independent of the representation of the expression values.
      compareNodes(operator, toNode(self), pattern, undefined),
    ),
  )
}
