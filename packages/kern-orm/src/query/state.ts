// States of queries in types: the parts that a query carries in one type parameter and its methods change.

import type { OperatorDefinitions } from "../expression/operators/definitions"
import type { ResultRows } from "../result/result"
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
 * State of a select query in types: its table, the relations of its schema, the record or value of its rows and the type of its value, how its rows become its result, and the relations it selects records of.
 *
 * Methods change only their own parts of the state.
 */
export interface SelectQueryState extends QueryState {
  readonly table: AnyTable
  readonly schema: SchemaContext
  // `unknown` rather than `QueryValueType`, and only the states of `expr` and `coalesce` narrow it, so that comparing a query with the state of a nested query or of an operand does not instantiate the operators of its type.
  /** Type of the value of a query of values, a `QueryValueType`; `never` for a query of records. */
  readonly valueType: unknown
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
  readonly rows: Rows
  readonly value: false
  readonly uses: U
  readonly guaranteed: Guaranteed
  readonly aggregate: false
}
