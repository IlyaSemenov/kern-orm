// States of the methods of `SelectQuery` in types: the states of the queries that they apply to, and of those that they return.

import type { GroupValue } from "../expression/aggregates"
import type {
  TypedOperand,
  TypedOperandInput,
  TypedOperandOperators,
} from "../expression/functions"
import type { OperandValue } from "../expression/operators/comparison"
import type { AnyTable, ColumnOperators, ColumnValues, Selectable } from "../table/table"

import type { CountValueType } from "./aggregate"
import type { OperandUses } from "./operand"
import type { FilteredRows, OneRow } from "./rows"
import type { ChangeState } from "./select"
import type { GroupedField, GroupedRecord, HelperFields, SelectedFieldTypes } from "./selection"
import type { FoundKey, Grouped, QueryValueType, SelectQueryState } from "./state"

// Non-distributive over the guarantee, so that a state that may be guaranteed relaxes its rows.
// The guarantee of the query of a helper callback, whose records are the marker, records only whether the callback filters, so its rows stay.
// The marker is checked with `value`, since a value of type `never` also matches it, and outside a tuple, so that a result of `any` gives the rows of both branches.
/** Rows mode of a query of state `S` after a filter: `FilteredRows` of a query whose row is guaranteed, and the rows of other queries. */
export type FilteredStateRows<S extends SelectQueryState> = [S["guaranteed"]] extends [false]
  ? S["rows"]
  : [S["value"]] extends [false]
    ? S["result"] extends HelperFields
      ? S["rows"]
      : FilteredRows<S["rows"], false>
    : FilteredRows<S["rows"], S["value"]>

/** State `S` after a filter, which ends the guarantee of its row. */
export type FilteredState<S extends SelectQueryState> = ChangeState<
  S,
  { rows: FilteredStateRows<S>; guaranteed: false }
>

// An interface of every part rather than `ChangeState` with `FoundKey`, whose intersection costs each `find` and `findBy` a third more instantiations.
/** State `S` after a filter followed by `take`, as `find` and `findBy` change it, with the columns `K` of their key for `upsert`. */
export interface FoundState<S extends SelectQueryState, K extends string>
  extends SelectQueryState, FoundKey<K> {
  readonly table: S["table"]
  readonly schema: S["schema"]
  readonly result: S["result"]
  readonly rows: OneRow<FilteredStateRows<S>>
  readonly value: S["value"]
  readonly valueType: S["valueType"]
  readonly fieldTypes: S["fieldTypes"]
  readonly uses: S["uses"]
  readonly guaranteed: false
  readonly aggregate: S["aggregate"]
}

/** State of a query of `find` or `findBy`, or of a singleton table, which `upsert` applies to. */
export type FoundQueryState = SelectQueryState & { readonly foundKey: string }

/** State of a query whose rows are records, which `select` and `clearSelect` change. */
export type RecordQueryState = SelectQueryState & { readonly value: false }

/** State of a query whose row no relation guarantees, which a filter keeps. */
export type UnguaranteedQueryState = SelectQueryState & { readonly guaranteed: false }

/** State of a query whose rows are values, made by `get`, `pluck`, an aggregate method, such as `count`, or `exists`. */
export type ValueQueryState = SelectQueryState & { readonly value: true }

/** State of a query converted by `map`, whose callback of `orderBy` reads no selected fields, which its result no longer tells. */
export type MappedQueryState = SelectQueryState & { readonly value: "mapped" }

/** State of a query of values with the values that the type of its value encodes, which `coalesce` takes; it narrows nothing else, so that a call compares no operators. */
export type CoalesceQueryState = ValueQueryState & {
  readonly valueType: { readonly input: unknown }
}

/** State of a query not made by an aggregate method or `exists`, which `get`, `pluck`, the aggregate methods, `exists`, and `groupBy` apply to. */
export type UnaggregatedQueryState = SelectQueryState & { readonly aggregate: false }

/** State of a query of values not made by an aggregate method or `exists`, such as of `pluck`, whose callback of `groupBy` reads its value. */
export type UnaggregatedValueQueryState = ValueQueryState & UnaggregatedQueryState

// A type of literal members rather than parameters of input and operators: an alias instantiates its arguments with each new mapper, also where no call reads them, and the operators of a type are object types that TypeScript instantiates again each time.
/** Type of the value of a query of column `K` of table `T`. */
export type ColumnValueType<T extends AnyTable, K extends keyof T["columns"]> = {
  readonly input: ColumnValues<T>[K]
  readonly operators: ColumnOperators<T, K>
}

/** Type of the value of a query of `E`, an expression or a query of one value that a callback returns. */
export type OperandValueType<E extends TypedOperand> = {
  readonly input: TypedOperandInput<E>
  readonly operators: TypedOperandOperators<E>
}

/** State `S` after grouping, with the values of its directly selected aggregates in nonempty groups. */
export interface GroupedState<S extends SelectQueryState> extends SelectQueryState {
  readonly table: S["table"]
  readonly schema: S["schema"]
  readonly result: GroupedResult<S>
  readonly rows: S["rows"]
  readonly value: S["value"]
  readonly valueType: S["valueType"]
  readonly fieldTypes: S["fieldTypes"]
  readonly uses: S["uses"]
  readonly guaranteed: S["guaranteed"]
  readonly aggregate: false & Grouped
}

/** Selected result after grouping, retaining the records or scalar value of the query. */
type GroupedResult<S extends SelectQueryState> = S["value"] extends false
  ? S["fieldTypes"] extends SelectedFieldTypes<unknown, unknown>
    ? GroupedRecord<S["result"], S["fieldTypes"]["types"]>
    : S["result"]
  : S["value"] extends true
    ? GroupedField<S["result"], S["valueType"]>
    : S["result"]

/** Type of a selected operand, carrying its value in a group for a later call of `groupBy`. */
export interface SelectedOperandType<E extends TypedOperand> extends QueryValueType {
  readonly input: TypedOperandInput<E>
  readonly operators: TypedOperandOperators<E>
  readonly group: E extends GroupValue<infer V> ? V : unknown
}

/** State of a query of the value `V` of type `Type` of an aggregate or of `exists` over the rows of a query of state `S`, which always returns one row. */
export type AggregateState<
  S extends SelectQueryState,
  V,
  Type extends QueryValueType,
> = ChangeState<
  S,
  { result: V; valueType: Type; rows: "one"; value: true; guaranteed: false; aggregate: true }
>

// Apart from `AggregateState`: a parameter of `AggregateState` for the relations would make every aggregate and `exists` cost more, and `ChangeState` of its result would make this state cost more.
/** State of a query of the value `V` of type `Type` of an aggregate over the rows of a query of state `S`, whose argument is `E`, an expression or a query of one value that a callback returns. */
export type OperandAggregateState<
  S extends SelectQueryState,
  V,
  Type extends QueryValueType,
  E,
> = ChangeState<
  S,
  {
    result: V
    valueType: Type
    rows: "one"
    value: true
    guaranteed: false
    aggregate: true
    uses: S["uses"] | OperandUses<E>
  }
>

/** State of a query of the number of rows or of values among the rows of a query of state `S`. */
export type CountState<S extends SelectQueryState> = AggregateState<S, number, CountValueType>

/** State of a query of an aggregate of the values of column `K` of the rows of a query of state `S`, `NULL` without values other than `NULL`. */
export type ColumnAggregateState<
  S extends SelectQueryState,
  K extends keyof S["table"]["columns"],
> = AggregateState<S, Selectable<S["table"]>[K] | null, ColumnValueType<S["table"], K>>

/** State of a query of an aggregate of the values of `E`, an expression or a query of one value that a callback returns, over the rows of a query of state `S`, `NULL` without values other than `NULL`. */
export type OperandValueAggregateState<
  S extends SelectQueryState,
  E extends TypedOperand,
> = OperandAggregateState<S, OperandValue<E> | null, OperandValueType<E>, E>

// `null` among the values of a type stands for `NULL`, so `coalesce` removes only `null`: `undefined` that a decoder returns stays.
// A fallback expression or query whose value can be `NULL` keeps `null`, while its other values are decoded by the type of the value.
/** Value `V` of a query of values whose `NULL` `coalesce` replaces with fallback `F`. */
export type CoalescedValue<V, F> = Exclude<V, null> | Extract<OperandValue<F>, null>

/** State of a query of many rows, which `limit` and `offset` apply to. */
export type ManyRowsQueryState = SelectQueryState & { readonly rows: "many" }

// `map` marks a query as an aggregate query to reject the methods that read its fields, but keeps its rows.
/** State of a query that returns rows of its table, which a row lock applies to: not of an aggregate or of `exists`. */
export type LockableQueryState = SelectQueryState &
  ({ readonly aggregate: false } | { readonly value: "mapped" })

/** State of a query of one row, which `optional` and `required` apply to. */
export type OneRowQueryState = SelectQueryState & { readonly rows: "one" | "nullable" | "optional" }

// The result of `map` is no value of a column, so `null` of its missing row does not read as `NULL`.
/** State of a query of one row whose rows are records or what `map` gives, which `nullable` applies to. */
export type OneRecordQueryState = OneRowQueryState & { readonly value: false | "mapped" }
