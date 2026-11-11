import { combineNodes } from "../ast/boolean"
import type { ExpressionNode } from "../ast/nodes"
import type {
  AnyExpression,
  Expression,
  ExpressionOperators,
  TypedExpression,
} from "../expression/expression"
import { isExpression, toBooleanExpression, toNode } from "../expression/expression"
import type { ComparisonSignature, Operand, OperandValue } from "../expression/operators/comparison"
import type { EqualityOperator } from "../expression/operators/equality"
import { isColumnValues } from "../expression/predicates"

import type { EqOperand } from "./filters"
import { matchColumn } from "./resolve-values"
import type { ExpressionInput, ExpressionValue } from "./selection"

/** Keys of the columns among references `R`, without the queries of relations. */
export type ColumnRefKey<R> = { [K in keyof R]: R[K] extends AnyExpression ? K : never }[keyof R]

/** Type that a key of the object of `matches` is checked against when it is not a column of its references, naming the columns. */
export interface NotAColumn<Keys> {
  readonly "keys must be columns of the references": Keys
}

// The operand of the `eq` of `equalityOperators` is read from the expression, as `EqValue` reads it from a column.
/** Value of column `E` in the object of `matches`: an operand of its `eq`, or `null` when its input type includes it. */
type MatchValue<E> =
  | (E extends TypedExpression
      ? ExpressionOperators<E> extends { readonly eq: EqualityOperator<ComparisonSignature> }
        ? Operand<ExpressionValue<E>, ExpressionInput<E>>
        : EqOperand<E>
      : EqOperand<E>)
  | (null extends ExpressionInput<E> ? null : never)

/**
 * Check of object `V` of `matches` against references `R`, which gives each of its keys the value of its column.
 *
 * It maps the keys of the object rather than those of the references, so that a call reads the operands of only the columns it matches.
 */
export type MatchCheck<R, V> = {
  readonly [K in keyof V]: K extends ColumnRefKey<R>
    ? MatchValue<R[K]>
    : NotAColumn<ColumnRefKey<R>>
}

/** `null` that matching expression `E` with value `V` adds to the result; `never` when `V` is `null`, since `IS NULL` is never `NULL`. */
type MatchNull<E, V> = V extends null
  ? never
  : E extends TypedExpression
    ? ExpressionOperators<E> extends { readonly eq: EqualityOperator<ComparisonSignature> }
      ? null extends ExpressionValue<E> | OperandValue<V>
        ? null
        : never
      : CustomEqNull<E>
    : CustomEqNull<E>

/** `null` of the result of a custom `eq` of expression `E`. */
type CustomEqNull<E> = E extends { eq: (...args: never[]) => AnyExpression<infer O> }
  ? Extract<O, null>
  : never

/** Value of `matches` of object `V` over references `R`: `boolean`, or also `null` when a comparison of a column can be `NULL`. */
export type MatchResult<R, V> =
  | boolean
  // Distributes over the objects of a union, whose common keys can leave out a nullable column.
  | (V extends unknown
      ? { [K in keyof V]-?: K extends keyof R ? MatchNull<R[K], V[K]> : never }[keyof V]
      : never)

/**
 * Creates a Boolean expression of an object of column values over the columns that a callback of a query receives, such as `matches(form, { published: true })`.
 *
 * Each value matches its column as in an object passed to `where`: `null` by `IS NULL`, and another value by the `eq` operator of the column; all of them must match, and an empty object is `TRUE`.
 * Unlike such an object in `and`, `or`, and `not`, the expression refers to the columns it receives whichever query it is used in, and applies wherever an expression does, such as in `select`.
 */
export function matches<
  R extends object,
  const V extends { readonly [K in ColumnRefKey<R>]?: unknown },
>(columns: R, values: V & MatchCheck<R, V>): Expression<MatchResult<R, V>>
export function matches(
  columns: Record<string, unknown>,
  values: Record<string, unknown>,
): Expression<boolean | null> {
  // Without keys, a value such as `false` would read as an empty object, which is `TRUE`, as in `where`.
  if (!isColumnValues(values)) {
    throw new TypeError("The values of matches must be an object of column values")
  }
  const conditions: ExpressionNode[] = []
  for (const key of Object.keys(values)) {
    const reference = columns[key]
    const column = isExpression(reference) ? toNode(reference) : undefined
    // Types also take computed expressions among the references and values of `any`, which may have no column to match.
    if (column?.kind !== "column" || column.source.kind !== "table") {
      throw new TypeError(`The references of matches have no column "${key}"`)
    }
    conditions.push(matchColumn(column.source, column.key, values[key]))
  }
  return toBooleanExpression(combineNodes("and", conditions))
}
