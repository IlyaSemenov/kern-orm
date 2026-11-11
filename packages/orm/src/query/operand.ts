// Queries of a table that expressions take as operands, in types: a query of one value and a query of the values of `in`.

import type { QueryValueType, SelectQueryState } from "./state"

/** Key of the value of a query in an expression, for types only. */
export declare const scalarValue: unique symbol

// An aggregate query and a query of `exists` always have their row, and a required relation guarantees the row of a query that keeps the guarantee, such as of `field.form`.
/** Value of a query of state `S` in an expression: its value, or `NULL` without its row unless the query always has it. */
export type ScalarValue<S extends SelectQueryState> = S["aggregate"] extends true
  ? S["result"]
  : S["guaranteed"] extends true
    ? S["result"]
    : S["result"] | null

/**
 * Query of one value of a table, such as of `get`, of an aggregate, or of `exists`, which an expression takes as a scalar subquery of its value, or as `EXISTS` of the rows of a query of `exists`.
 *
 * `T` is its value there: without its row, a query of `get` is `NULL`, unless a required relation guarantees the row, such as of `field.form`.
 */
// An interface rather than an intersection with `QueryOf`, which TypeScript would compare with every method of the query.
export interface ScalarQuery<T = unknown> {
  /** Value of the query in an expression, from which an expression infers `T`. */
  readonly [scalarValue]: T
  readonly types: ScalarQueryState
  // A method of a query, which TypeScript drops from the type of a spread copy of a query, so that such a copy is rejected.
  readonly exists: unknown
}

/** Value of query `Q` of one value in an expression. */
export type ScalarQueryValue<Q extends ScalarQuery> = Q[typeof scalarValue]

/** Relations whose records `E`, an expression or a query of one value that a callback returns, selects: those of a query, as an expression does not carry the relations of its queries. */
export type OperandUses<E> = E extends ScalarQuery ? E["types"]["uses"] : never

/** State of a query of one value, which an expression takes. */
export interface ScalarQueryState extends SelectQueryState {
  readonly rows: "one" | "optional"
  readonly value: true
}

/** State of a query of one value with the type of its value, whose expression `expr` gives. */
export interface ExpressionQueryState extends ScalarQueryState {
  readonly valueType: QueryValueType
}

/** Query of one value of a table with the type of its value, such as of `get` or of an aggregate, which gives the expression of a function the decoding and the operators of its value. */
// An interface rather than an intersection with `QueryOf`, as `ScalarQuery` is.
export interface TypedScalarQuery extends ScalarQuery {
  readonly types: ExpressionQueryState
}

/** Query of values of a table of any rows, such as of `pluck`, whose value is `T`, which `in` takes as a subquery of its values. */
// An interface rather than an intersection with `QueryOf`, as `ScalarQuery` is.
export interface ValuesQuery<T = unknown> {
  readonly types: ValuesQueryState<T>
  // A method of a query, which TypeScript drops from the type of a spread copy of a query, so that such a copy is rejected.
  readonly exists: unknown
}

/** Value of query `Q` of values, of each of its rows. */
export type ValuesQueryValue<Q extends ValuesQuery> = Q["types"]["result"]

/** State of a query of values whose value is `T`. */
interface ValuesQueryState<T> extends SelectQueryState {
  readonly result: T
  readonly value: true
}
