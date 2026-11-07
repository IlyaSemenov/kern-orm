import type { GroupValue } from "../expression/aggregates"
import type { AnyExpression, TypedExpression } from "../expression/expression"
import type { TypedOperand } from "../expression/functions"
import type { OperandValue } from "../expression/operators/comparison"
import type { AnyTable } from "../table/table"
import type { IsAny, Simplify } from "../utils/type-helpers"

import type { TransformedQuery, TransformedQueryState } from "./conversion"
import type { SelectQueryKind } from "./kind"
import type { Literal } from "./literal"
import type { QueryResult } from "./rows"
import type { QueryOf } from "./select"
import type { ColumnValueType, OperandValueType } from "./select-method-state"
import type { EmptyRecord, SelectQueryState } from "./state"

/** Expressions, nested queries, and literals selected under the keys of the result fields; a record has no symbol keys. */
export interface Selection {
  readonly [key: string]: TypedExpression | NestedQuery | Literal<unknown>
  readonly [key: symbol]: never
}

/** Query whose rows a selection nests as the value of a field: a query of any state and kind, such as a query of a relation, also converted by `map` or `transform`. */
export type NestedQuery =
  | QueryOf<SelectQueryState>
  | TransformedQuery<TransformedQueryState, SelectQueryKind>

/** Record of the values of the expressions, of the nested rows, and of the literals of a selection. */
export type SelectionResult<S extends Selection> = {
  [K in keyof S]: FieldValue<S[K]>
}

/** Record of a selection in a query of groups. */
export type GroupSelectionResult<S extends Selection> = {
  [K in keyof S]: GroupFieldValue<S[K]>
}

/** Value of a field selected in a group, leaving nested queries and literals unchanged. */
type GroupFieldValue<V> = V extends GroupValue<infer T> ? T : FieldValue<V>

/** Value of an operand in a query of groups. */
export type GroupOperandValue<E> = E extends GroupValue<infer T> ? T : OperandValue<E>

/** Value of a selected field: of an expression, of the nested rows of a query as the result of executing it, or of a literal, for each member of a union of them. */
type FieldValue<V> = V extends NestedQuery
  ? QueryResult<V["types"]>
  : V extends Literal<infer T>
    ? T
    : ExpressionValue<V>

/** Relations whose records the nested queries of a selection select. */
export type SelectionUses<S extends Selection> = S[keyof S] extends infer V
  ? V extends NestedQuery
    ? V["types"]["uses"]
    : never
  : never

/** Value of a selected expression. */
export type ExpressionValue<E> = E extends AnyExpression<infer T> ? T : never

/** Values that the type of an expression encodes, such as in place of its value. */
export type ExpressionInput<E> = E extends AnyExpression<unknown, infer I> ? I : never

declare const helperFields: unique symbol

/** Marker of the input fields of a helper, carrying the keys selected by its callback. */
export interface HelperFields<Keys extends PropertyKey = PropertyKey> {
  readonly [helperFields]: Keys
}

/** Result `R` of a callback of a helper without the marker, which a record of the callback keeps, also through a spread, so that the declarations of a module exporting a helper never name it; `any` stays `any`. */
export type WithoutHelperFields<R> =
  IsAny<R> extends true
    ? R
    : R extends HelperFields
      ? { [K in keyof R as K extends keyof HelperFields ? never : K]: R[K] }
      : R

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

/** Types of the values of columns `K` of table `T` as selected fields: the values that each encodes and its operators. */
export type ColumnFieldTypes<T extends AnyTable, K extends keyof T["columns"]> = {
  [P in K]: ColumnValueType<T, P>
}

// A literal and the rows of a nested query other than of one value have no type of a value, so the callback of `having` gets them without operators; a query of one value, such as of `get`, has the type of its value, though reading its field throws there, as for any nested rows.
/** Types of the values of the expressions and the queries of one value of selection `Sel`, under the keys of the result records, as `MergeSelection` normalizes them. */
export type SelectionFieldTypes<Sel> = {
  [K in keyof Sel as K extends number ? `${K}` : K]: FieldType<Exclude<Sel[K], undefined>>
}

/** Type of the value of a selected field `F`, for each member of a union of them, so that each keeps its own operators and values. */
type FieldType<F> = F extends TypedOperand
  ? F extends GroupValue<infer T>
    ? OperandValueType<F> & { readonly group: T }
    : OperandValueType<F>
  : unknown

/** Record `R` of a query whose rows become groups, with field types `F`. */
export type GroupedRecord<R, F> =
  IsAny<R> extends true
    ? R
    : R extends unknown
      ? {
          // An absent field contributes undefined to the record, not to the nullability of an aggregate that is present.
          [K in keyof R]: K extends keyof F ? GroupedField<R[K], Exclude<F[K], undefined>> : R[K]
        }
      : never

/** Value of a selected field after grouping; a union of field types must all guarantee a non-null value to remove `null`. */
export type GroupedField<V, D> = [D] extends [{ readonly group: infer G }]
  ? null extends G
    ? V
    : Exclude<V, null>
  : V

/** Types of the values of fields `P` with those of fields `N` added or replaced, by the rules of `MergeSelection`, for each branch of either. */
export type MergeFieldTypes<P, N> = P extends unknown
  ? N extends unknown
    ? // Inside the distribution, so that the keys of a union do not hide those of a branch.
      [keyof N] extends [never]
      ? P
      : [keyof P] extends [never]
        ? N
        : {
            [K in keyof P | keyof N]: K extends keyof N
              ? {} extends Pick<N, K>
                ? // An optional replacement may be absent, so the previous type stays possible.
                  K extends keyof P
                  ? P[K] | Exclude<N[K], undefined>
                  : Exclude<N[K], undefined>
                : N[K]
              : K extends keyof P
                ? P[K]
                : never
          }
    : never
  : never

// An interface defers the merge until the types are read, such as by `having`: comparing states, such as with the constraint of a helper, relates its type arguments, and only a structural comparison of them merges the types.
// `P` is declared covariant, since TypeScript measures it as bivariant through the conditional types of the merge, which would relate a field of a literal to one of an expression.
/** Types of the values of the selected fields of a query: those of `P`, the `fieldTypes` part of the state before a selection, with `N` added or replaced. */
export interface SelectedFieldTypes<out P, N> {
  readonly types: MergeFieldTypes<SelectedFieldTypesOf<P>, N>
}

/** Types of the values of the selected fields of the `fieldTypes` part `F` of a state, by key; none for `EmptyRecord` of a query without selected fields. */
export type SelectedFieldTypesOf<F> =
  F extends SelectedFieldTypes<unknown, unknown> ? F["types"] : EmptyRecord
