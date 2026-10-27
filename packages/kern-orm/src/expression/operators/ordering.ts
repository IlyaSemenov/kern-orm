import type { ComparisonNode } from "../../ast/nodes"

import type { ComparisonSignature } from "./comparison"
import { compare } from "./comparison"
import { equalityOperators } from "./equality"
import { defineGenericOperator } from "./generic"

/** Operators of ordered types: those of `equalityOperators`, and `lt`, `lte`, `gt`, and `gte` comparing with operands of the expression type. */
export const orderingOperators = {
  ...equalityOperators,
  lt: createComparison("<"),
  lte: createComparison("<="),
  gt: createComparison(">"),
  gte: createComparison(">="),
}

function createComparison(operator: ComparisonNode["operator"]) {
  return defineGenericOperator<ComparisonSignature>((self, value) => compare(self, operator, value))
}
