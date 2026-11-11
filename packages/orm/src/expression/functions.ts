// Functions of expressions: SQL functions of several operands and `CASE`, whose results are `NULL` by rules of their own, which their types follow.

import type { ExpressionNode } from "../ast/nodes"
import { createList, createNode } from "../ast/nodes"
import type { ScalarQuery, TypedScalarQuery } from "../query/operand"
import { SelectQuery } from "../query/select"
import type { ExpressionInput } from "../query/selection"
import type { AnyType, Type } from "../type/type"
import { describeRejectedCodec, isType } from "../type/type"

import type { AnyExpression, Expression, ExpressionOperators, TypedExpression } from "./expression"
import {
  getType,
  isExpression,
  isOperandSource,
  operandNode,
  toCastValueNode,
  toExpression,
  toFunctionOperandNode,
  toNode,
} from "./expression"
import type { Operand, OperandValue } from "./operators/comparison"
import type { OperatorDefinitions } from "./operators/definitions"
import type { Predicate } from "./predicates"

/** First operand of `coalesce`, `greatest`, and `least`: an expression with a type, or a query of one value, such as of an aggregate, whose type decodes the result and gives it its operators. */
export type TypedOperand = TypedExpression | TypedScalarQuery

/** Values that the type of the first operand `F` encodes. */
export type TypedOperandInput<F> = F extends TypedScalarQuery
  ? F["types"]["valueType"]["input"]
  : ExpressionInput<F>

/** Operators of the type of the first operand `F`. */
export type TypedOperandOperators<F> = F extends TypedScalarQuery
  ? F["types"]["valueType"]["operators"]
  : F extends TypedExpression
    ? ExpressionOperators<F>
    : never

/** Operand of `coalesce`, `greatest`, and `least` after the first operand `F`: a value that its type encodes, or an expression or a query of one value of its values. */
export type FollowingOperand<F> = Operand<OperandValue<F>, TypedOperandInput<F>>

// An array in place of a tuple may be empty, so its values tell nothing about the result.
// The operands are `const`, since TypeScript otherwise widens a literal of a union of literals, such as of an enum, which then fails the constraint, so that `R` is the constraint itself, an array that takes `null`.
/** `null` when every operand can be `NULL`: the first operand `F` and the following operands `R`. */
type NullOfEveryOperand<F, R extends readonly unknown[]> =
  null extends OperandValue<F>
    ? number extends R["length"]
      ? null
      : { [K in keyof R]: null extends OperandValue<R[K]> ? never : true }[number] extends never
        ? null
        : never
    : never

// `null` among the values of a type stands for `NULL`, so only `null` is removed: `undefined` that a decoder returns stays.
/** Result of a function of the first operand `F` and the following operands `R` that is `NULL` only when every operand is, whose operands all have the values of `F`. */
export type NullSkippingResult<F, R extends readonly unknown[]> = Expression<
  Exclude<OperandValue<F>, null> | NullOfEveryOperand<F, R>,
  TypedOperandOperators<F>,
  TypedOperandInput<F>
>

/**
 * Returns the first of its operands other than `NULL`, such as `coalesce(field.hint, "")`, as an expression usable wherever a column is.
 *
 * `first` is an expression with a type or a query of one value; its type decodes the result and gives it its operators, and encodes plain values among `rest`.
 * A query without its row is `NULL` here, unlike with the method `coalesce` of a query, which keeps a missing row missing.
 */
export function coalesce<F extends TypedOperand, const R extends readonly FollowingOperand<F>[]>(
  first: F,
  ...rest: R
): NullSkippingResult<F, R>
export function coalesce(first: unknown, ...rest: unknown[]): unknown {
  return callFunction("coalesce", first, rest)
}

/**
 * Returns the largest of its operands, skipping `NULL`, which is the result only when every operand is `NULL`.
 *
 * `first` is an expression with a type or a query of one value; its type decodes the result and gives it its operators, and encodes plain values among `rest`.
 */
export function greatest<F extends TypedOperand, const R extends readonly FollowingOperand<F>[]>(
  first: F,
  ...rest: R
): NullSkippingResult<F, R>
export function greatest(first: unknown, ...rest: unknown[]): unknown {
  return callFunction("greatest", first, rest)
}

/**
 * Returns the smallest of its operands, skipping `NULL`, which is the result only when every operand is `NULL`.
 *
 * `first` is an expression with a type or a query of one value; its type decodes the result and gives it its operators, and encodes plain values among `rest`.
 */
export function least<F extends TypedOperand, const R extends readonly FollowingOperand<F>[]>(
  first: F,
  ...rest: R
): NullSkippingResult<F, R>
export function least(first: unknown, ...rest: unknown[]): unknown {
  return callFunction("least", first, rest)
}

/** Condition of a branch of `caseWhen`: a predicate, or a query of one Boolean value, such as of `exists`. */
export type CaseCondition = Predicate | ScalarQuery<boolean | null>

/** Value of a branch of `caseWhen` of a type of values `T` that encodes values `I`: an operand of the type, or a plain `null`. */
export type CaseValue<T, I> = Operand<T, I> | null

/** Branch of `caseWhen`: a condition and the value of the result when it holds. */
export type CaseBranch<T, I> = readonly [condition: CaseCondition, value: CaseValue<T, I>]

// `null` among the values of a type stands for `NULL`, so only `null` is removed, and the values of the branches tell whether the result can be `NULL`: a nullable type alone does not make the result nullable.
/** Value of `caseWhen` of a type of values `T` whose branches and fallback have the values `V`, of which one gives the result. */
type CaseResult<T, V> = Exclude<T, null> | Extract<OperandValue<V>, null>

/**
 * Returns the value of the first branch whose condition holds, as a SQL `CASE` expression, or `NULL` when none holds.
 *
 * `type` decodes the result and gives it its operators, and a plain value of a branch is cast to it, so that PostgreSQL does not take plain values for text.
 */
export function caseWhen<Output, Input, O extends OperatorDefinitions>(
  // oxlint-disable-next-line typescript/no-explicit-any -- type parameters do not matter here
  type: Type<Output, Input, O, any>,
  branches: NoInfer<readonly CaseBranch<Output, Input>[]>,
): Expression<Exclude<Output, null> | null, O, Input>
/**
 * Returns the value of the first branch whose condition holds, as a SQL `CASE` expression, or `otherwise` when none holds.
 *
 * `type` decodes the result and gives it its operators, and a plain value of a branch or of `otherwise` is cast to it, so that PostgreSQL does not take plain values for text.
 */
export function caseWhen<
  Output,
  Input,
  O extends OperatorDefinitions,
  const B extends readonly CaseBranch<Output, Input>[],
  const E extends CaseValue<Output, Input>,
>(
  // oxlint-disable-next-line typescript/no-explicit-any -- type parameters do not matter here
  type: Type<Output, Input, O, any>,
  branches: B,
  otherwise: E,
): Expression<CaseResult<Output, B[number][1] | E>, O, Input>
export function caseWhen(
  type: AnyType,
  branches: readonly (readonly [unknown, unknown])[],
  otherwise?: unknown,
): unknown {
  if (!isType(type)) {
    throw new TypeError(
      `caseWhen() accepts a type, not ${describeRejectedCodec(type) ?? "a column"}`,
    )
  }
  // PostgreSQL rejects `CASE` without a branch, while a list built in code may be empty, as those of `and` and `or` may.
  if (branches.length === 0) {
    return toExpression(toCastValueNode(otherwise === undefined ? null : otherwise, type), type)
  }
  const fragments: string[] = []
  const values: ExpressionNode[] = []
  for (const branch of branches) {
    fragments.push(values.length === 0 ? "CASE WHEN " : " WHEN ", " THEN ")
    values.push(toCaseConditionNode(branch[0]), toCastValueNode(branch[1], type))
  }
  if (otherwise !== undefined) {
    fragments.push(" ELSE ")
    values.push(toCastValueNode(otherwise, type))
  }
  fragments.push(" END")
  return toExpression(createNode({ kind: "raw", fragments, values }), type)
}

/** Converts a condition of `caseWhen` into a node, rejecting a value other than an expression or a query, such as an object of column values, which has no table here. */
function toCaseConditionNode(condition: unknown): ExpressionNode {
  if (!isOperandSource(condition)) {
    throw new TypeError("A condition of caseWhen must be an expression or a query of one value")
  }
  return condition[operandNode]()
}

// A plain value takes no cast: PostgreSQL types its parameter by the other operands, and the first operand is never a parameter without a type.
/** Creates the expression of the call of the SQL function `name`, of the type of its first operand. */
function callFunction(name: string, first: unknown, rest: readonly unknown[]): AnyExpression {
  const expression = toTypedExpression(first, `The first operand of ${name}`)
  const type = getType(expression)!
  const operands: ExpressionNode[] = [toNode(expression)]
  for (const value of rest) {
    operands.push(toFunctionOperandNode(value, type, name))
  }
  return toExpression(createList(`${name}(`, operands, ")"), type)
}

/** Converts an operand, which the error names as `subject`, into an expression with a type, rejecting any other value. */
export function toTypedExpression(value: unknown, subject: string): AnyExpression {
  // `expr` rejects a query other than of one value.
  const expression = value instanceof SelectQuery ? value.expr() : value
  if (!isExpression(expression) || getType(expression) === undefined) {
    throw new TypeError(
      `${subject} must be a query of one value of a table or an expression with a type to decode the result; build a sql fragment with a type, such as sql(t.integer)`,
    )
  }
  return expression
}
