// Constant conditions. Creating them reads the Boolean type, which the modules of expressions create on first use inside their import cycle, so no module of that cycle may import this one.

import { falseNode, trueNode } from "../ast/nodes"
import { getBooleanType } from "../type/boolean"

import type { Expression } from "./expression"
import { toExpression } from "./expression"

/** Condition that always holds, such as for a branch of `and` built in code: `and(check, isAdmin ? TRUE : other)`. */
export const TRUE: Expression<boolean> = /* @__PURE__ */ toExpression<boolean>(
  trueNode,
  /* @__PURE__ */ getBooleanType(),
)

/** Condition that never holds, such as for a branch of `or` built in code: `or(check, isAdmin ? other : FALSE)`. */
export const FALSE: Expression<boolean> = /* @__PURE__ */ toExpression<boolean>(
  falseNode,
  /* @__PURE__ */ getBooleanType(),
)
