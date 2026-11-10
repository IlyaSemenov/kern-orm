import type { ExpressionNode, RawSqlNode } from "../ast/nodes"
import { createNode } from "../ast/nodes"
import { quoteIdentifier } from "../database/identifier"
import { TransformedQuery } from "../query/conversion"
import { MutationQuery } from "../query/mutation"
import { isTableQuery } from "../query/node"
import type { ScalarQuery, ScalarQueryValue } from "../query/operand"
import { RecordQuery } from "../query/record"
import { SelectQuery } from "../query/select"
import { SqlQuery } from "../query/sql-query"
import type { AnyType, Type } from "../type/type"
import { isType } from "../type/type"

import type { AnyExpression, Expression, UntypedExpression } from "./expression"
import { getType, isExpression, toCastValueNode, toExpression, toValueNode } from "./expression"
import type { Operand } from "./operators/comparison"
import type { OperatorDefinitions } from "./operators/definitions"

/** Tagged template building a SQL fragment of values `T` that accepts compared values `I`. */
export type SqlTemplate<T, O extends OperatorDefinitions, I = T> = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Expression<T, O, I>

/**
 * Builds a SQL fragment.
 *
 * Interpolated expressions such as column references stay structured, a query of a table without clauses, such as `db.form`, becomes the name of the table, and other values become query parameters.
 * Another query of a table becomes a subquery in parentheses, and a query of one value, such as of an aggregate or of `exists`, its value, as in a condition.
 * The type argument declares the TypeScript type of the fragment and does not convert values at runtime, so the fragment cannot be selected; the fragment has `isNull` and the operators of `equalityOperators` only.
 */
export function sql<T = unknown>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): UntypedExpression<T>
/**
 * Creates a template building SQL fragments of `type`.
 *
 * The fragments have the operators of the type and encode compared values with it; the type adds no SQL cast.
 */
export function sql<Output, Input, O extends OperatorDefinitions>(
  // oxlint-disable-next-line typescript/no-explicit-any -- type parameters do not matter here
  type: Type<Output, Input, O, any>,
): SqlTemplate<Output, O, Input>
export function sql(first: TemplateStringsArray | AnyType, ...values: unknown[]): unknown {
  if (isTemplateStrings(first)) {
    return createFragment(first, values, undefined)
  }
  if (!isType(first)) {
    throw new TypeError("sql() accepts a type, not a column")
  }
  return (strings: TemplateStringsArray, ...values: unknown[]) =>
    createFragment(strings, values, first)
}

/**
 * Creates a SQL fragment of a quoted name, such as of a table or a column known only at runtime, for the templates of `sql`, of `$query` and `$script` of a `Db`, and of `query` and `script` of a `Database`.
 *
 * Several names make a qualified name, such as `identifier(schema, table)` for `"schema"."table"`.
 * The fragment has no parameters, so a script takes it.
 * The name is not qualified by the PostgreSQL schema of the statement.
 */
export function identifier(...names: [string, ...string[]]): UntypedExpression {
  let text = ""
  for (const name of names) {
    if (typeof name !== "string" || name === "") {
      throw new TypeError("identifier() takes names as non-empty strings")
    }
    // Each name is quoted whole and never split at dots, since a quoted name may contain them.
    text += (text === "" ? "" : ".") + quoteIdentifier(name)
  }
  if (text === "") {
    throw new TypeError("identifier() takes at least one name")
  }
  return toExpression(
    createNode({ kind: "raw", fragments: [text], values: [] }),
  ) as UntypedExpression
}

/**
 * Creates an expression of a query parameter encoded with a type, for a value interpolated into `sql` or compared on its own.
 *
 * With a type, the parameter is cast to it, such as `$1::integer`, so that PostgreSQL applies the operators of the type even where nothing else in the statement determines it.
 * The cast omits type parameters, such as `$1::numeric` for `numeric(10,2)`, so that their precision, scale, or length do not constrain the value.
 *
 * With an expression, such as `param(self, other)` in an operator definition, the type of the expression encodes the value, and the parameter is not cast: PostgreSQL types it by the expression it is used with.
 * `value` may then also be an expression, such as an operand of a generic operator, which is returned as it is, with its own type and nullability.
 * A query of one value becomes an expression with the runtime type of the first argument and the nullability of the query, typed as an `AnyExpression` of its value.
 */
export function param<Output, Input, O extends OperatorDefinitions>(
  // oxlint-disable-next-line typescript/no-explicit-any -- type parameters do not matter here
  type: Type<Output, Input, O, any>,
  value: Input,
): Expression<Output, O, Input>
export function param<
  E extends AnyExpression,
  V extends (E extends AnyExpression<infer T, infer I> ? Operand<T, I> : never),
>(
  type: E,
  value: V,
): V extends AnyExpression ? V : V extends ScalarQuery ? AnyExpression<ScalarQueryValue<V>> : E
export function param(type: AnyType | AnyExpression, value: unknown): AnyExpression {
  if (!isType(type) && !isExpression(type)) {
    throw new TypeError("param() accepts a type or an expression, not a column")
  }
  if (isExpression(type)) {
    if (isExpression(value)) {
      return value
    }
    const valueType = getType(type)
    return toExpression(toValueNode(value, valueType), valueType)
  }
  return toExpression(toCastValueNode(value, type), type)
}

function isTemplateStrings(value: TemplateStringsArray | AnyType): value is TemplateStringsArray {
  return Array.isArray(value)
}

function createFragment(
  strings: TemplateStringsArray,
  values: unknown[],
  type: AnyType | undefined,
): AnyExpression {
  return toExpression(toRawSqlNode(strings, values), type)
}

/**
 * Creates the node of the SQL of a template, whose interpolations stay structured nodes.
 *
 * An interpolated expression keeps its node, and a query of a table without clauses becomes the name of the table, qualified by the PostgreSQL schema of the statement.
 * Another query of a table becomes a query in an expression, which lowering replaces with its SQL.
 * Other values become query parameters.
 * It rejects the other queries, which a parameter would encode as text.
 */
export function toRawSqlNode(
  strings: TemplateStringsArray,
  values: readonly unknown[],
): RawSqlNode {
  const nodes: ExpressionNode[] = []
  for (let index = 0; index < values.length; index++) {
    nodes.push(toInterpolatedNode(values[index]))
  }
  return createNode({ kind: "raw", fragments: [...strings], values: nodes })
}

/** Returns the node of a value interpolated into SQL, as `toRawSqlNode` takes it. */
function toInterpolatedNode(value: unknown): ExpressionNode {
  if (value instanceof SelectQuery) {
    const { node } = value
    // SQL reads the rows without their conversion.
    if (node.conversion !== undefined) {
      throw new TypeError(
        "sql takes a query of a table, such as db.form or a query of its records, not a query of map or transform",
      )
    }
    // SQL text also takes a query of records or of rows `many`, which `operandNode` rejects, so the node is created here.
    return isTableQuery(node)
      ? createNode({ kind: "tableName", table: value.table, db: value.db })
      : createNode({ kind: "nestedQuery", query: node, db: value.db })
  }
  if (
    value instanceof RecordQuery ||
    value instanceof MutationQuery ||
    value instanceof SqlQuery ||
    value instanceof TransformedQuery
  ) {
    throw new TypeError(
      "sql takes a query of a table, such as db.form or a query of its records, not a query of $select, a mutation, a query of SQL text, or a query of map or transform",
    )
  }
  return toValueNode(value)
}
