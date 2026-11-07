// Aggregate functions of expressions: SQL aggregates that a query selects beside each other, so that one statement reads several of them, unlike the aggregate methods of a query, each of which makes a query of its own value.

import type { AggregateMethod, CountValueType } from "../query/aggregate"
import {
  countProjection,
  countType,
  createAggregateCall,
  toAggregateType,
} from "../query/aggregate"

import type { AnyExpression, Expression } from "./expression"
import { getType, toExpression, toNode } from "./expression"
import type { TypedOperand, TypedOperandInput, TypedOperandOperators } from "./functions"
import { toTypedExpression } from "./functions"
import type { OperandValue } from "./operators/comparison"

/** Expression of a count: a number, with the operators of `orderingOperators`. */
export type CountExpression = Expression<
  number,
  CountValueType["operators"],
  CountValueType["input"]
>

/** Expression of an aggregate of the values of `E`, an expression or a query of one value, `NULL` without values other than `NULL`, with the operators of its type. */
export type AggregateExpression<E extends TypedOperand> = Expression<
  OperandValue<E> | null,
  TypedOperandOperators<E>,
  TypedOperandInput<E>
>

/** Returns the number of the rows of the query that selects it, or of each of its groups, as `count(*)`. */
export function count(): CountExpression
/** Returns the number of the values of `value`, an expression with a type or a query of one value, other than `NULL`. */
export function count(value: TypedOperand): CountExpression
export function count(...values: readonly unknown[]): unknown {
  // Rest parameters tell a call without an argument from an argument of `undefined`, which would count the rows silently.
  return values.length === 0
    ? toExpression(countProjection.expression, countType)
    : callAggregate("count", values[0])
}

/** Returns the number of the distinct values of `value`, an expression with a type or a query of one value, other than `NULL`. */
export function countDistinct(value: TypedOperand): CountExpression
export function countDistinct(value: unknown): unknown {
  return callAggregate("countDistinct", value)
}

/** Returns the smallest of the values of `value`, an expression with a type or a query of one value, or `null` without values other than `NULL`. */
export function min<E extends TypedOperand>(value: E): AggregateExpression<E>
export function min(value: unknown): unknown {
  return callAggregate("min", value)
}

/** Returns the largest of the values of `value`, an expression with a type or a query of one value, or `null` without values other than `NULL`. */
export function max<E extends TypedOperand>(value: E): AggregateExpression<E>
export function max(value: unknown): unknown {
  return callAggregate("max", value)
}

/** Returns the sum of the values of `value`, an expression with a type or a query of one value, or `null` without values other than `NULL`. */
export function sum<E extends TypedOperand>(value: E): AggregateExpression<E>
export function sum(value: unknown): unknown {
  return callAggregate("sum", value)
}

/** Returns the average of the values of `value`, an expression with a type or a query of one value, or `null` without values other than `NULL`; for `bigint` values, average an expression of a type that can represent fractional values. */
export function avg<E extends TypedOperand>(value: E): AggregateExpression<E>
export function avg(value: unknown): unknown {
  return callAggregate("avg", value)
}

/** Returns whether every value of `value`, a Boolean expression with a type or a query of one Boolean value, other than `NULL` is true, or `null` without such values. */
export function every<E extends TypedOperand>(value: E): AggregateExpression<E>
export function every(value: unknown): unknown {
  return callAggregate("every", value)
}

/** Returns whether any value of `value`, a Boolean expression with a type or a query of one Boolean value, is true, or `null` without values other than `NULL`. */
export function some<E extends TypedOperand>(value: E): AggregateExpression<E>
export function some(value: unknown): unknown {
  return callAggregate("some", value)
}

/** Creates the expression of the aggregate of `method` over the values of `value`, of the type that decodes its value. */
function callAggregate(method: AggregateMethod, value: unknown): AnyExpression {
  const expression = toTypedExpression(value, `The argument of ${method}`)
  return toExpression(
    createAggregateCall(method, toNode(expression)),
    toAggregateType(method, getType(expression)!),
  )
}
