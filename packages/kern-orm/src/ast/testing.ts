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
  TableSourceNode,
} from "./nodes"
import { createNode, trueNode } from "./nodes"

/** Creates a scalar subquery as an expression of `type`. */
export function createSubquery(query: SelectNode, type: AnyType) {
  return toExpression(createNode({ kind: "subquery", query }), type)
}

/** Creates `EXISTS` of the rows of a query as a Boolean expression. */
export function createExists(query: SelectNode) {
  return toBooleanExpression(createNode({ kind: "exists", query }))
}

/** Creates a subquery interpolated into SQL text as an expression without a type. */
export function createTextSubquery(query: SelectNode) {
  return toExpression(createNode({ kind: "textSubquery", query }))
}

/** Creates `IN` of the values of a query as a Boolean expression. */
export function createInQuery(operand: ExpressionNode, query: SelectNode) {
  return toBooleanExpression(createNode({ kind: "inQuery", operand, query }))
}

/** Options of a derived source of `createDerivedSource`. */
export interface DerivedSourceOptions {
  /** Whether the source is `LATERAL`. */
  readonly lateral?: boolean
  /** Occurrence of a table of the query that the source replaces. */
  readonly replaces?: TableSourceNode
}

/** Creates an occurrence of a query in `FROM`, plain unless `options` make it `LATERAL`. */
export function createDerivedSource(
  query: SelectNode,
  { lateral = false, replaces }: DerivedSourceOptions = {},
): DerivedSourceNode {
  return Object.freeze(
    replaces === undefined
      ? { kind: "derived", query, lateral }
      : { kind: "derived", query, lateral, replaces },
  )
}

/** Creates a reference to a column of a table or a field of a derived source. */
export function createRef(source: SourceNode, key: string): ColumnRefNode {
  return createNode({ kind: "column", source, key })
}

/** Creates a `LEFT JOIN` of a source. */
export function createLeftJoin(source: SourceNode, on: ExpressionNode = trueNode): JoinNode {
  return Object.freeze({ type: "left", source, on })
}

/** Creates a sort key of `ORDER BY`. */
export function createOrder(
  expression: ExpressionNode,
  direction: OrderNode["direction"] = "asc",
  nulls?: OrderNode["nulls"],
): OrderNode {
  return Object.freeze({ expression, direction, nulls })
}

/** Creates an untyped parameter, such as a number of rows. */
export function createParameter(value: unknown): ParamNode {
  return createNode({ kind: "param", value, type: undefined })
}
