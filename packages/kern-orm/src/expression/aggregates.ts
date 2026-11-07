// Aggregate functions of expressions: SQL aggregates that a query selects beside each other, so that one statement reads several of them, unlike the aggregate methods of a query, each of which makes a query of its own value.

import type { ExpressionNode, OrderNode } from "../ast/nodes"
import { noOrder } from "../ast/nodes"
import type { AggregateMethod, CountValueType } from "../query/aggregate"
import {
  countProjection,
  countType,
  createAggregateCall,
  createCountCall,
  toAggregateType,
} from "../query/aggregate"
import type { ScalarQuery } from "../query/operand"
import type { OrderTerms } from "../query/order"
import { addTerms } from "../query/order"

import type { AnyExpression, Expression } from "./expression"
import { getType, isOperandSource, operandNode, toExpression, toNode } from "./expression"
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

/** Options of an aggregate function. */
export interface AggregateOptions {
  /** Condition of the rows that the function aggregates, as `FILTER (WHERE ...)`: a Boolean expression or a query of one Boolean value. */
  readonly filter?: AnyExpression<boolean | null> | ScalarQuery<boolean | null>
}

/** Options of `stringAgg`. */
export interface StringAggOptions extends AggregateOptions {
  /** Order in which the values are joined: a sort key or an array of them, as the callback of `orderBy` of a query returns; without it, PostgreSQL joins them in any order. */
  readonly orderBy?: OrderTerms
}

/** Returns the number of the rows of the query that selects it, or of each of its groups, as `count(*)`. */
export function count(): CountExpression
/** Returns the number of the rows of the query that selects it, or of each of its groups, as `count(*)`; `options.filter` chooses the rows that it counts. */
export function count(options: AggregateOptions): CountExpression
/** Returns the number of the values of `value`, an expression with a type or a query of one value, other than `NULL`; `options.filter` chooses the rows that it takes. */
export function count(value: TypedOperand, options?: AggregateOptions): CountExpression
export function count(...values: readonly unknown[]): unknown {
  // Rest parameters tell a call without an argument from an argument of `undefined`, which would count the rows silently.
  if (values.length === 0) {
    return toExpression(countProjection.expression, countType)
  }
  const first = values[0]
  if (values.length === 1 && isOptions(first)) {
    const filter = readFilter(first, "count")
    return toExpression(
      filter === undefined ? countProjection.expression : createCountCall(filter),
      countType,
    )
  }
  return callAggregate("count", first, values[1])
}

/** Returns the number of the distinct values of `value`, an expression with a type or a query of one value, other than `NULL`; `options.filter` chooses the rows that it takes. */
export function countDistinct(value: TypedOperand, options?: AggregateOptions): CountExpression
export function countDistinct(value: unknown, options?: unknown): unknown {
  return callAggregate("countDistinct", value, options)
}

/** Returns the smallest of the values of `value`, an expression with a type or a query of one value, or `null` without values other than `NULL`; `options.filter` chooses the rows that it takes. */
export function min<E extends TypedOperand>(
  value: E,
  options?: AggregateOptions,
): AggregateExpression<E>
export function min(value: unknown, options?: unknown): unknown {
  return callAggregate("min", value, options)
}

/** Returns the largest of the values of `value`, an expression with a type or a query of one value, or `null` without values other than `NULL`; `options.filter` chooses the rows that it takes. */
export function max<E extends TypedOperand>(
  value: E,
  options?: AggregateOptions,
): AggregateExpression<E>
export function max(value: unknown, options?: unknown): unknown {
  return callAggregate("max", value, options)
}

/** Returns the sum of the values of `value`, an expression with a type or a query of one value, or `null` without values other than `NULL`; `options.filter` chooses the rows that it takes. */
export function sum<E extends TypedOperand>(
  value: E,
  options?: AggregateOptions,
): AggregateExpression<E>
export function sum(value: unknown, options?: unknown): unknown {
  return callAggregate("sum", value, options)
}

/**
 * Returns the average of the values of `value`, an expression with a type or a query of one value, or `null` without values other than `NULL`; `options.filter` chooses the rows that it takes.
 *
 * For `bigint` values, average an expression of a type that can represent fractional values.
 */
export function avg<E extends TypedOperand>(
  value: E,
  options?: AggregateOptions,
): AggregateExpression<E>
export function avg(value: unknown, options?: unknown): unknown {
  return callAggregate("avg", value, options)
}

/** Returns whether every value of `value`, a Boolean expression with a type or a query of one Boolean value, other than `NULL` is true, or `null` without such values; `options.filter` chooses the rows that it takes. */
export function every<E extends TypedOperand>(
  value: E,
  options?: AggregateOptions,
): AggregateExpression<E>
export function every(value: unknown, options?: unknown): unknown {
  return callAggregate("every", value, options)
}

/** Returns whether any value of `value`, a Boolean expression with a type or a query of one Boolean value, is true, or `null` without values other than `NULL`; `options.filter` chooses the rows that it takes. */
export function some<E extends TypedOperand>(
  value: E,
  options?: AggregateOptions,
): AggregateExpression<E>
export function some(value: unknown, options?: unknown): unknown {
  return callAggregate("some", value, options)
}

/** Returns the values other than `NULL` of `value`, a text expression with a type or a query of one text value, joined with `delimiter` in the order of `options.orderBy`, or `null` without such values; `options.filter` chooses the rows that it takes. */
export function stringAgg<E extends TypedOperand>(
  value: E,
  delimiter: string,
  options?: StringAggOptions,
): AggregateExpression<E>
export function stringAgg(value: unknown, delimiter: unknown, options?: unknown): unknown {
  if (typeof delimiter !== "string") {
    throw new TypeError("The delimiter of stringAgg must be a string")
  }
  return callAggregate("stringAgg", value, options, delimiter)
}

/**
 * Creates the expression of the aggregate of `method` over the values of `value`, of the type that decodes its value, with the options of `options`.
 *
 * `delimiter` is the delimiter of `stringAgg`, whose options also take `orderBy`.
 */
function callAggregate(
  method: AggregateMethod,
  value: unknown,
  options: unknown,
  delimiter?: string,
): AnyExpression {
  const expression = toTypedExpression(value, `The argument of ${method}`)
  const filter = readFilter(options, method)
  let orderBy = noOrder
  const terms =
    method === "stringAgg" ? (options as StringAggOptions | undefined)?.orderBy : undefined
  if (terms !== undefined) {
    const order: OrderNode[] = []
    addTerms(order, terms, "The option orderBy of stringAgg takes")
    orderBy = order
  }
  return toExpression(
    createAggregateCall(method, toNode(expression), delimiter, orderBy, filter),
    toAggregateType(method, getType(expression)!),
  )
}

// Another object, such as a `Date` passed by mistake as the argument of `count`, must not read as options without a filter, which would count every row.
/** Tells whether `value` is an object of options rather than an argument: a plain object, of this or another realm, other than an expression. */
function isOptions(value: unknown): value is object {
  if (typeof value !== "object" || value === null || isOperandSource(value)) {
    return false
  }
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === null || Object.getPrototypeOf(prototype) === null
}

/**
 * Returns the node of the condition of `options`, the options of the aggregate function `method`, or `undefined` without options or a condition.
 *
 * It rejects options other than a plain object and a key other than the options of `method`, so that an object of column values passed instead of an argument fails rather than leaving the rows unfiltered.
 * It rejects a condition other than an expression or a query of one value, such as an object of column values, which has no table to resolve against there.
 */
function readFilter(options: unknown, method: AggregateMethod): ExpressionNode | undefined {
  if (options === undefined) {
    return undefined
  }
  if (!isOptions(options)) {
    throw new TypeError(`The options of ${method} must be a plain object`)
  }
  for (const key of Object.keys(options)) {
    if (key !== "filter" && (key !== "orderBy" || method !== "stringAgg")) {
      throw new TypeError(`${method} has no option ${JSON.stringify(key)}`)
    }
  }
  const { filter } = options as AggregateOptions
  if (filter === undefined) {
    return undefined
  }
  if (!isOperandSource(filter)) {
    throw new TypeError(
      `The filter of ${method} must be an expression or a query of one Boolean value`,
    )
  }
  return filter[operandNode]()
}
