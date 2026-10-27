import { createNode } from "../ast/nodes"
import type { AnyType, Type } from "../type/type"
import { isType } from "../type/type"

import type { AnyExpression, Expression, UntypedExpression } from "./expression"
import { getType, isExpression, toExpression, toValueNode } from "./expression"
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
 * Interpolated expressions such as column references stay structured, and other values become query parameters.
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
 * Creates an expression of a query parameter encoded with a type, for a value interpolated into `sql` or compared on its own.
 *
 * With a type, the parameter is cast to it, such as `$1::integer`, so that PostgreSQL applies the operators of the type even where nothing else in the statement determines it.
 * The cast omits type parameters, such as `$1::numeric` for `numeric(10,2)`, so that their precision, scale, or length do not constrain the value.
 *
 * With an expression, such as `param(self, other)` in an operator definition, the type of the expression encodes the value, and the parameter is not cast: PostgreSQL types it by the expression it is used with.
 * `value` may then also be an expression, such as an operand of a generic operator, which is returned as it is, with its own type and nullability.
 */
export function param<Output, Input, O extends OperatorDefinitions>(
  // oxlint-disable-next-line typescript/no-explicit-any -- type parameters do not matter here
  type: Type<Output, Input, O, any>,
  value: Input,
): Expression<Output, O, Input>
export function param<
  E extends AnyExpression,
  V extends (E extends AnyExpression<infer T, infer I> ? Operand<T, I> : never),
>(type: E, value: V): V extends AnyExpression ? V : E
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
  const node = toValueNode(value, type)
  return toExpression(
    node.kind === "param" ? createNode({ kind: "cast", operand: node, type }) : node,
    type,
  )
}

function isTemplateStrings(value: TemplateStringsArray | AnyType): value is TemplateStringsArray {
  return Array.isArray(value)
}

function createFragment(
  strings: TemplateStringsArray,
  values: unknown[],
  type: AnyType | undefined,
): AnyExpression {
  return toExpression(
    createNode({
      kind: "raw",
      fragments: [...strings],
      values: values.map(value => toValueNode(value)),
    }),
    type,
  )
}
