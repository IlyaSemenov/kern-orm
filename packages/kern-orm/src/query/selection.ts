import type { AnyExpression, TypedExpression } from "../expression/expression"
import type { IsAny, Simplify } from "../utils/type-helpers"

import type { QueryResult } from "./rows"
import type { QueryOfState, SelectQueryState } from "./select"

/** Expressions and nested queries selected under the keys of the result fields; a record has no symbol keys. */
export interface Selection {
  readonly [key: string]: TypedExpression | NestedQuery
  readonly [key: symbol]: never
}

/** Query whose rows a selection nests as the value of a field: a query of any state and kind, such as a query of a relation. */
export type NestedQuery = QueryOfState<SelectQueryState>

/** Record of the values of the expressions and of the nested rows of a selection. */
export type SelectionResult<S extends Selection> = {
  [K in keyof S]: FieldValue<S[K]>
}

/** Value of a selected field: of an expression, or of the nested rows of a query as the result of executing it, for each member of a union of them. */
type FieldValue<V> = V extends NestedQuery ? QueryResult<V["types"]> : ExpressionValue<V>

/** Relations whose records the nested queries of a selection select. */
export type SelectionUses<S extends Selection> = S[keyof S] extends infer V
  ? V extends NestedQuery
    ? V["types"]["uses"]
    : never
  : never

/** Value of a selected expression. */
export type ExpressionValue<E> = E extends AnyExpression<infer T> ? T : never

declare const helperFields: unique symbol

/** Marker of the input fields of a helper, carrying the keys selected by its callback. */
export interface HelperFields<Keys extends PropertyKey = PropertyKey> {
  readonly [helperFields]: Keys
}

/** Records with `Fields` added or replaced, for each branch of either record type; `any` stays `any`. */
export type MergeSelection<Previous, Fields> = Previous extends unknown
  ? // Distributing over Previous keeps this alias in inferred generic declarations instead of expanding its mapped types.
    Fields extends unknown
    ? MergeFields<RecordFields<Previous>, RecordFields<Fields>> &
        (IsAny<Previous> extends true ? Previous : unknown)
    : never
  : never

/** Fields with numeric keys represented as the string keys used in result records. */
type RecordFields<Fields> = Fields extends unknown
  ? // Most selections already have string keys, so they need no mapped copy.
    [Extract<keyof Fields, number>] extends [never]
    ? Fields
    : { [K in keyof Fields as K extends number ? `${K}` : K]: Fields[K] }
  : never

/** Merge of normalized fields, retaining the previous value when an optional replacement is absent. */
type MergeFields<Previous, Fields> = Simplify<
  {
    [
      K in keyof Previous as K extends keyof Fields ? ({} extends Pick<Fields, K> ? K : never) : K
    ]: K extends typeof helperFields
      ? // A branch selecting extra keys must not be reduced to one selecting fewer fields or none.
        Previous[K] | keyof Fields
      : K extends keyof Fields
        ? // A decoder can return undefined, so it cannot be excluded as merely an absent property.
          Previous[K] | Fields[K]
        : Previous[K]
  } & {
    // Optional overlapping fields are handled above to preserve the input field's requiredness.
    [
      K in keyof Fields as K extends keyof Previous ? ({} extends Pick<Fields, K> ? never : K) : K
    ]: Fields[K]
  }
>
