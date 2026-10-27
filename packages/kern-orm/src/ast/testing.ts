// Builders of SQL AST nodes for tests that construct statements directly.

import { toBooleanExpression, toExpression } from "../expression/expression"
import type { AnyType } from "../type/type"

import type {
  ColumnRefNode,
  DerivedSourceNode,
  ExpressionNode,
  JoinNode,
  OrderNode,
  ParamNode,
  SelectNode,
  SourceNode,
} from "./nodes"
import { createNode, trueNode } from "./nodes"

/** Scalar subquery as an expression of `type`. */
export function subquery(query: SelectNode, type: AnyType) {
  return toExpression(createNode({ kind: "subquery", query }), type)
}

/** `EXISTS` of the rows of a query as a Boolean expression. */
export function exists(query: SelectNode) {
  return toBooleanExpression(createNode({ kind: "exists", query }))
}

/** Occurrence of a query in `FROM`, plain or `LATERAL`. */
export function derived(query: SelectNode, lateral: boolean): DerivedSourceNode {
  return Object.freeze({ kind: "derived", query, lateral })
}

/** Reference to a column of a table or a field of a derived source. */
export function ref(source: SourceNode, key: string): ColumnRefNode {
  return createNode({ kind: "column", source, key })
}

/** `LEFT JOIN` of a source. */
export function leftJoin(source: SourceNode, on: ExpressionNode = trueNode): JoinNode {
  return Object.freeze({ type: "left", source, on })
}

/** Sort key of `ORDER BY`. */
export function orderBy(
  expression: ExpressionNode,
  direction: OrderNode["direction"] = "asc",
  nulls?: OrderNode["nulls"],
): OrderNode {
  return Object.freeze({ expression, direction, nulls })
}

/** Untyped parameter, such as a number of rows. */
export function parameter(value: unknown): ParamNode {
  return createNode({ kind: "param", value, type: undefined })
}
