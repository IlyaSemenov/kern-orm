// States of queries in types: the parts that a query carries in one type parameter and its methods change.

import type { ResultRows } from "../database/result"
import type { OperatorDefinitions } from "../expression/operators/definitions"
import type { NoRelations, SchemaContext, UsedRelation } from "../schema/relation"
import type { AnyTable } from "../table/table"

/** Records of a query without selected fields. */
export type EmptyRecord = Record<never, never>

/** State of a query in types: the record or value of its rows, how its rows become its result, and the relations it selects records of. */
export interface QueryState {
  /** Record of a row, or the value of its only field for a query made by `get`, `pluck`, an aggregate method, such as `count`, or `exists`, or what the callback of `map` or `transform` returns. */
  readonly result: unknown
  /** How the rows become the result. */
  readonly rows: ResultRows
  /**
   * What a row is: a record for `false`, the value of its only field for `true`, or what a callback of code returns: of `map` for `"mapped"`, whichever the row was before it, or of `transform` for `"transformed"`, of the whole result.
   *
   * The states of the methods that read the fields of a row or the value of its only field narrow it to `false` or `true`, so that they reject a query that code converts.
   */
  readonly value: boolean | "mapped" | "transformed"
  /** Relations whose records the query and the queries nested in it select, which a `Db` must have. */
  readonly uses: UsedRelation
}

/** Type of the value of a query: the values that it encodes, such as the fallback of `coalesce`, and its operators, which `expr` gives its expression. */
export interface QueryValueType {
  readonly input: unknown
  readonly operators: OperatorDefinitions
}

/**
 * State of a select query in types: its table, the relations of its schema, the record or value of its rows, the type of its value or the types of its fields, how its rows become its result, and the relations it selects records of.
 *
 * Methods change only their own parts of the state.
 */
export interface SelectQueryState extends QueryState {
  readonly table: AnyTable
  readonly schema: SchemaContext
  // `unknown` rather than `QueryValueType`, and only the states of `expr` and `coalesce` narrow it, so that comparing a query with the state of a nested query or of an operand does not instantiate the operators of its type.
  /** Type of the value of a query of values, a `QueryValueType`; `never` for a query of records. */
  readonly valueType: unknown
  // `result` holds only the decoded values, which do not tell the operators of a field.
  // `SelectedFieldTypes` defers the merge of each selection until the types are read, such as by `having` or a structural comparison of states, so that most queries do not merge the types of their fields.
  /** Types of the values of the selected fields of a query of records, the values that each encodes and its operators, which the callback of `having` gives its references: a `SelectedFieldTypes`, or `EmptyRecord` without selected fields. */
  readonly fieldTypes: unknown
  /**
   * Whether a required relation guarantees the row of the query, such as of `field.form`.
   *
   * The relation does not guarantee a record that also passes a filter, so `where`, `find`, and `findBy` end the guarantee and make rows `one` `nullable`, or `optional` for a query of values; `optional`, `nullable`, and `required` end it as well.
   * The callback of a helper starts with it, so that the effect of the helper records whether the callback filters.
   */
  readonly guaranteed: boolean
  /** Whether the query is made by an aggregate method, such as `count`, or by `exists`, or converted by `map`, which makes `get`, `pluck`, the aggregate methods, and `exists` reject it. */
  readonly aggregate: boolean
}

// An interface rather than an intersection lets a call infer `T` and `C` from a query.
/** State of a query over table `T` with schema context `C`, whatever its result. */
export interface QueryStateOf<
  T extends AnyTable,
  C extends SchemaContext = SchemaContext,
> extends SelectQueryState {
  readonly table: T
  readonly schema: C
}

/**
 * State of a query that starts from table `T` with schema context `C`: rows as records without fields, all of them or of the records of relation `U` when given, in rows mode `Rows`, guaranteed by a required relation when `Guaranteed`.
 *
 * Without relations in `C`, it also types a query of the table in a schema that has relations of the table.
 */
export interface InitialQueryState<
  T extends AnyTable,
  C extends SchemaContext = NoRelations,
  U extends UsedRelation = never,
  Rows extends ResultRows = "many",
  Guaranteed extends boolean = false,
> extends QueryStateOf<T, C> {
  readonly result: EmptyRecord
  readonly valueType: never
  readonly fieldTypes: EmptyRecord
  readonly rows: Rows
  readonly value: false
  readonly uses: U
  readonly guaranteed: Guaranteed
  readonly aggregate: false
}

/**
 * State of a query that starts from table `T` with schema context `C`, as the entry points of a schema and a `Db` and `from` start it: of all the rows of the table, or of the one row of a singleton table.
 *
 * Where the type of `T` does not tell whether it is a singleton, such as `Table<Name, Columns>`, it is the union of both.
 */
export type TableQueryState<
  T extends AnyTable,
  C extends SchemaContext = NoRelations,
> = SingletonOrInitialState<T, C, T["singleton"]>

// Distributive over `Singleton`, so that `boolean` gives the union of both states, and a table of a generic type, such as `T extends typeof form`, gives the state of the constraint of its `singleton`, which a conditional type of `T["singleton"]` itself defers.
/** State of a query that starts from table `T` with schema context `C`, as `TableQueryState` gives it, by `Singleton`, the `singleton` of the type of `T`. */
type SingletonOrInitialState<
  T extends AnyTable,
  C extends SchemaContext,
  Singleton,
> = Singleton extends true ? SingletonQueryState<T, C> : InitialQueryState<T, C>

// The state of `find` of a key without columns, so that `upsert` applies to it as to a query of `find`, and the methods that change the state drop the key as they do for `find`.
/** State of a query that starts from singleton table `T` with schema context `C`: its one row as a record without fields, which resolves to `undefined` without it. */
export interface SingletonQueryState<T extends AnyTable, C extends SchemaContext = NoRelations>
  extends InitialQueryState<T, C, never, "optional">, FoundKey<never> {}

/** Key of the member of `FoundKey` that makes it invariant in the columns of the key. */
declare const foundKeyVariance: unique symbol

/** Part of the state of a query of `find` or `findBy` with the columns `K` of its key, or of a query of a singleton table without them, which `upsert` applies to. */
export interface FoundKey<K extends string> {
  // Outside of `SelectQueryState`, so that every change of the state by `ChangeState` drops it; the methods that keep the state keep it too.
  readonly foundKey: K
  // With `foundKey`, it keeps a query of one key from standing for a query of another, even of a key of more columns, so that `upsert` takes the values by the key of the query.
  // An object of the columns rather than a function of them, which needs `strictFunctionTypes`, and a member rather than a variance annotation, which TypeScript ignores where it compares the members of a state.
  readonly [foundKeyVariance]: { readonly [C in K]: true }
}

/** Mark of `aggregate: false` of a query of groups, which aggregate methods replace. */
export interface Grouped {
  readonly grouped: true
}
