import type { ExpressionNode, NestedQueryNode, ScalarProjection } from "../ast/nodes"
import { createNode } from "../ast/nodes"
import type { CompileOptions } from "../compiler/postgres/compile"
import type { AnyDb } from "../execution/db"
import type { SqlStatement } from "../execution/driver"
import type { AnyExpression, Expression } from "../expression/expression"
import { operandNode, toExpression } from "../expression/expression"
import type { TypedOperand } from "../expression/functions"
import type { Operand, OperandValue } from "../expression/operators/comparison"
import { valuesQueryNode } from "../expression/operators/equality"
import type { ResultRows } from "../result/result"
import type { SchemaContext } from "../schema/relation"
import type { AnyTable, Selectable } from "../table/table"

import type { AggregateMethod, CountValueType } from "./aggregate"
import { countProjection, isAggregateQuery, projectAggregate } from "./aggregate"
import type { ColumnRefs, QueryContext, RelationRefs } from "./column-refs"
import { noContext } from "./column-refs"
import type { SynchronousResult, TransformedQuery, TransformedQueryState } from "./conversion"
import { addMap, transformQuery } from "./conversion"
import type { ExistsValueType } from "./exists"
import { getExistsProjection, isExistsQuery } from "./exists"
import type { EqValue, QueryWhereFilter, WhereFilter } from "./filters"
import { addUserFilter } from "./filters"
import type { KeyCheck, PrimaryKeyValues } from "./find"
import { toKeyValues, toPrimaryKeyValues } from "./find"
import type { GroupTerms } from "./group"
import { addGroupKeys, addHaving } from "./group"
import type { AnyQuery, QueryDb, QueryThen, SelectQueryKind, ToSQLArgs } from "./kind"
import { compileToSQL, executeOnAwait } from "./kind"
import type { RowLockOptions } from "./lock"
import { createRowLock } from "./lock"
import type { AnyMutationQuery, InitialMutationState } from "./mutation"
import { createDelete, createInsert, createUpdate, MutationQuery } from "./mutation"
import type { QueryNode } from "./node"
import { createQueryNode } from "./node"
import type {
  ExpressionQueryState,
  OperandUses,
  ScalarQueryValue,
  ScalarValue,
  scalarValue,
} from "./operand"
import type { OrderKey, OrderTerms, SelectedRefs } from "./order"
import { addOrder } from "./order"
import { createPageCount } from "./pagination"
import { coalesceValue, mergeProjections, projectValue } from "./projections"
import type { OneRow, OneValueRows, QueryResult, ValueRows } from "./rows"
import { limitToOne, toFilteredRows, toValueRows } from "./rows"
import type {
  AggregateState,
  CoalescedValue,
  CoalesceQueryState,
  ColumnAggregateState,
  ColumnValueType,
  CountState,
  FilteredState,
  FoundState,
  LockableQueryState,
  ManyRowsQueryState,
  MappedQueryState,
  OneRecordQueryState,
  OneRowQueryState,
  OperandAggregateState,
  OperandValueAggregateState,
  OperandValueType,
  RecordQueryState,
  UnaggregatedQueryState,
  UnaggregatedValueQueryState,
  UnguaranteedQueryState,
  ValueQueryState,
} from "./select-method-state"
import type { MergeSelection, Selection, SelectionResult, SelectionUses } from "./selection"
import type { EmptyRecord, InitialQueryState, QueryStateOf, SelectQueryState } from "./state"
import type { InsertValues, UpdateSet, UpdateValues } from "./values"

// Declared in the module of `SelectQuery`: declared in another module, it keeps TypeScript 6 and `bun check` from reducing a union of queries that differ by their fields, such as `cond ? query.select("id", "title") : query.select("id")`, to one query, so that methods that change the state reject the union.
/** State `S` with the parts of `Changes` replaced. */
export type ChangeState<S extends SelectQueryState, Changes extends Partial<SelectQueryState>> = {
  readonly [K in keyof SelectQueryState]: K extends keyof Changes ? Changes[K] : S[K]
} & {}

/** Query of state `S`, bound or unbound. */
export type QueryOf<S extends SelectQueryState> = SelectQuery<S, SelectQueryKind>

/** Changes of the node of a query, which a method collects before it derives a query from them. */
type NodeChanges = { -readonly [K in keyof QueryNode]?: QueryNode[K] }

/**
 * Immutable select query of state `S`, unbound or bound to a `Db`.
 *
 * Every method returns a query of the same kind and leaves this query unchanged.
 * An unbound query is not thenable, so it can be returned from async functions; it is compiled with `toSQL` or executed by a `Db`.
 * A bound query executes on its `Db` when awaited.
 */
// The classes of queries repeat these members rather than share a base class, which would add to the instantiations of nearly every query and to the time of deriving it.
// Methods take the query they are called on from `this` rather than from the parameters of the class, so that the parameters reach only members that keep the query covariant in them, as `out` declares and TypeScript checks.
// So a query of a narrower state or kind is a query of a wider one, and comparing two queries of different states compares their states rather than their methods.
// - The methods that keep the state in types, such as `orderBy`, `where` of a query whose row is not guaranteed, and `use`, which returns the query of its callback, take the whole query as `Q`, so that they also apply to a union of queries.
// - A method that changes the state takes the state and the kind of the query as its own `S` and `Kind`; TypeScript infers one state from a union of queries of different states, which the other queries do not fit.
export class SelectQuery<
  out S extends SelectQueryState,
  out Kind extends SelectQueryKind = "unbound",
> {
  declare readonly types: S
  /** Value of the query in an expression, for types only. */
  declare readonly [scalarValue]: ScalarValue<S>
  /** `Db` that executes the query when it is awaited; `undefined` for an unbound query. */
  readonly db: QueryDb<Kind>
  /** Executes a bound query on its `Db`; `undefined` for an unbound query, so that it is not thenable. */
  // oxlint-disable-next-line unicorn/no-thenable -- awaiting a bound query executes it; unbound queries are not thenable
  readonly then: QueryThen<S, Kind>

  constructor(
    readonly table: S["table"],
    readonly node: QueryNode,
    /** Relations of the table in the schema the query starts from, which its callbacks receive. */
    readonly context: QueryContext,
    db?: AnyDb,
  ) {
    this.db = db as QueryDb<Kind>
    // oxlint-disable-next-line unicorn/no-thenable -- only a bound query gets a function
    this.then = (db === undefined ? undefined : executeOnAwait) as QueryThen<S, Kind>
    Object.freeze(this)
  }

  // A query whose row no relation guarantees keeps its state, so that a union of such queries takes `where`.
  /** Adds a filter combined with `AND` with the previous ones; a callback receives the columns and the queries of the relations of the table. */
  where<Q extends QueryOf<UnguaranteedQueryState>>(this: Q, filter: QueryWhereFilter<Q["types"]>): Q
  /**
   * Adds a filter combined with `AND` with the previous ones; a callback receives the columns and the queries of the relations of the table.
   *
   * A query of the record of a required relation, such as `field.form`, resolves to `null` without a record that passes the filter, or to `undefined` after `get` or `pluck`.
   */
  where<S extends SelectQueryState, Kind extends SelectQueryKind>(
    this: SelectQuery<S, Kind>,
    filter: QueryWhereFilter<S>,
  ): SelectQuery<FilteredState<S>, Kind>
  where(filter: WhereFilter<AnyTable>): unknown {
    return this.derive(this.addFilter(filter))
  }

  /** Selects all columns of the table, replacing fields under their keys. */
  select<S extends RecordQueryState, Kind extends SelectQueryKind>(
    this: SelectQuery<S, Kind>,
    all: "*",
  ): SelectQuery<
    ChangeState<S, { result: MergeSelection<S["result"], Selectable<S["table"]>> }>,
    Kind
  >
  /** Selects the listed columns, replacing fields under their keys. */
  select<
    S extends RecordQueryState,
    Kind extends SelectQueryKind,
    K extends keyof S["table"]["columns"] & string,
  >(
    this: SelectQuery<S, Kind>,
    ...keys: K[]
  ): SelectQuery<
    ChangeState<S, { result: MergeSelection<S["result"], Pick<Selectable<S["table"]>, K>> }>,
    Kind
  >
  /**
   * Selects the expressions and nested queries returned by `callback`, replacing fields under their keys.
   *
   * `callback` receives the columns and the queries of the relations of the table.
   * Each expression is decoded with its type, so it must have one: a column, an operator result, or a fragment of `sql(type)`, but not of `sql<T>`.
   * A nested query is unbound, such as a query of a relation, or bound to the `Db` that runs the query; its rows become the value of its field as they become the result of an executed query.
   */
  select<S extends RecordQueryState, Kind extends SelectQueryKind, Sel extends Selection>(
    this: SelectQuery<S, Kind>,
    // An intersection rather than one alias of both, so that queries of one table compare the same column references.
    callback: (columns: ColumnRefs<S["table"]> & RelationRefs<S["schema"]>) => Sel,
  ): SelectQuery<
    ChangeState<
      S,
      {
        result: MergeSelection<S["result"], SelectionResult<Sel>>
        uses: S["uses"] | SelectionUses<Sel>
      }
    >,
    Kind
  >
  select(...args: unknown[]): unknown {
    this.rejectValue("select")
    return this.derive({
      projections: mergeProjections(this.node.projections, this.node.from, args, this.context),
    })
  }

  /** Removes all selected fields and keeps the other clauses. */
  clearSelect<S extends RecordQueryState, Kind extends SelectQueryKind>(
    this: SelectQuery<S, Kind>,
  ): SelectQuery<ChangeState<S, { result: EmptyRecord }>, Kind>
  clearSelect(): unknown {
    this.rejectValue("clearSelect")
    return this.derive({ projections: [] })
  }

  /**
   * Limits the query to one row and returns the row instead of an array; without a row, it rejects with `NotFoundError` unless `optional` or `nullable` makes the query resolve to `undefined` or `null`.
   * When a required relation still guarantees the row, such as of `field.form`, it rejects with `RequiredRelationError` instead.
   *
   * A query of one row stays as it is.
   */
  take<S extends SelectQueryState, Kind extends SelectQueryKind>(
    this: SelectQuery<S, Kind>,
  ): SelectQuery<ChangeState<S, { rows: OneRow<S["rows"]> }>, Kind>
  take(): unknown {
    return this.deriveTaken({})
  }

  /**
   * Filters the query by the values of the primary key of the table, in the order of its columns, and returns the row instead of an array, as `where` followed by `take`, but without a limit.
   *
   * A value is what `where` takes for its column, such as an expression, but never `null` or `undefined`.
   * Without a row, it rejects with `NotFoundError` unless `optional` or `nullable` makes the query resolve to `undefined` or `null`.
   */
  find<S extends SelectQueryState, Kind extends SelectQueryKind>(
    this: SelectQuery<S, Kind>,
    ...values: PrimaryKeyValues<S["table"]>
  ): SelectQuery<FoundState<S>, Kind>
  find(...values: readonly unknown[]): unknown {
    return this.takeWhere(toPrimaryKeyValues(this.table, values))
  }

  /**
   * Filters the query by the values of the columns of one key of the table, primary or unique, and returns the row instead of an array, as `where` followed by `take`, but without a limit.
   *
   * A value is what `where` takes for its column, such as an expression, but never `null` or `undefined`.
   * Without a row, it rejects with `NotFoundError` unless `optional` or `nullable` makes the query resolve to `undefined` or `null`.
   */
  findBy<
    S extends SelectQueryState,
    Kind extends SelectQueryKind,
    K extends keyof S["table"]["columns"] & string,
  >(
    this: SelectQuery<S, Kind>,
    // A mapped type rather than an alias, so that errors show the columns and their values rather than the table.
    values: { readonly [C in K]: NonNullable<EqValue<S["table"], C>> } & KeyCheck<S["table"], K>,
  ): SelectQuery<FoundState<S>, Kind>
  findBy(values: unknown): unknown {
    return this.takeWhere(toKeyValues(this.table, values))
  }

  /**
   * Replaces the selected fields with a column, limits the query to one row, and returns the value of the column instead of a record.
   *
   * Without a row, it rejects with `NotFoundError`, or with `RequiredRelationError` when a required relation still guarantees the row, such as of `field.form`.
   * An optional or nullable query resolves to `undefined` without a row instead.
   * A `NULL` value is `null`.
   */
  get<
    S extends UnaggregatedQueryState,
    Kind extends SelectQueryKind,
    K extends keyof S["table"]["columns"] & string,
  >(
    this: SelectQuery<S, Kind>,
    key: K,
  ): SelectQuery<
    ChangeState<
      S,
      {
        result: Selectable<S["table"]>[K]
        valueType: ColumnValueType<S["table"], K>
        rows: OneValueRows<S["rows"]>
        value: true
      }
    >,
    Kind
  >
  /**
   * Replaces the selected fields with the expression returned by `callback`, limits the query to one row, and returns the value of the expression instead of a record.
   *
   * `callback` receives the columns and the queries of the relations of the table.
   * It may return a query of one value, such as of an aggregate of related records, which gives `NULL` without its row.
   * Without a row, it rejects with `NotFoundError`, or with `RequiredRelationError` when a required relation still guarantees the row, such as of `field.form`.
   * An optional or nullable query resolves to `undefined` without a row instead.
   * A `NULL` value is `null`.
   */
  get<S extends UnaggregatedQueryState, Kind extends SelectQueryKind, E extends TypedOperand>(
    this: SelectQuery<S, Kind>,
    callback: (columns: ColumnRefs<S["table"]> & RelationRefs<S["schema"]>) => E,
  ): SelectQuery<
    ChangeState<
      S,
      {
        result: OperandValue<E>
        valueType: OperandValueType<E>
        rows: OneValueRows<S["rows"]>
        value: true
        uses: S["uses"] | OperandUses<E>
      }
    >,
    Kind
  >
  get(arg: unknown): unknown {
    this.rejectAggregate("get")
    // The changes of `pluck` followed by `take`.
    return this.deriveTaken({
      projections: [projectValue(this.node.from, arg, "get", this.context)],
      value: true,
      rows: toValueRows(this.node.rows),
    })
  }

  /**
   * Replaces the selected fields with a column and returns the value of the column of each row instead of a record.
   *
   * It keeps whether the query returns an array or one value, such as after `take`, and how it handles a missing row, except that a nullable query resolves to `undefined` without a row.
   */
  pluck<
    S extends UnaggregatedQueryState,
    Kind extends SelectQueryKind,
    K extends keyof S["table"]["columns"] & string,
  >(
    this: SelectQuery<S, Kind>,
    key: K,
  ): SelectQuery<
    ChangeState<
      S,
      {
        result: Selectable<S["table"]>[K]
        valueType: ColumnValueType<S["table"], K>
        rows: ValueRows<S["rows"]>
        value: true
      }
    >,
    Kind
  >
  /**
   * Replaces the selected fields with the expression returned by `callback` and returns the value of the expression for each row instead of a record.
   *
   * `callback` receives the columns and the queries of the relations of the table.
   * It may return a query of one value, such as of an aggregate of related records, which gives `NULL` without its row.
   * It keeps whether the query returns an array or one value, such as after `take`, and how it handles a missing row, except that a nullable query resolves to `undefined` without a row.
   */
  pluck<S extends UnaggregatedQueryState, Kind extends SelectQueryKind, E extends TypedOperand>(
    this: SelectQuery<S, Kind>,
    callback: (columns: ColumnRefs<S["table"]> & RelationRefs<S["schema"]>) => E,
  ): SelectQuery<
    ChangeState<
      S,
      {
        result: OperandValue<E>
        valueType: OperandValueType<E>
        rows: ValueRows<S["rows"]>
        value: true
        uses: S["uses"] | OperandUses<E>
      }
    >,
    Kind
  >
  pluck(arg: unknown): unknown {
    this.rejectAggregate("pluck")
    return this.derive({
      projections: [projectValue(this.node.from, arg, "pluck", this.context)],
      value: true,
      rows: toValueRows(this.node.rows),
    })
  }

  // An aggregate query always has its row, so no relation needs to guarantee it, and a filter keeps its rows mode.
  /**
   * Replaces the selected fields with the number of rows of the query and returns the number instead of the rows.
   *
   * It keeps the filters and ignores the order; with `limit` or `offset`, it counts the rows of that page, and after `groupBy`, the groups.
   */
  count<S extends UnaggregatedQueryState, Kind extends SelectQueryKind>(
    this: SelectQuery<S, Kind>,
  ): SelectQuery<CountState<S>, Kind>
  /** Replaces the selected fields with the number of the values of the column other than `NULL` among the rows of the query and returns it instead of the rows. */
  count<
    S extends UnaggregatedQueryState,
    Kind extends SelectQueryKind,
    K extends keyof S["table"]["columns"] & string,
  >(this: SelectQuery<S, Kind>, key: K): SelectQuery<CountState<S>, Kind>
  /**
   * Replaces the selected fields with the number of the values other than `NULL` of the expression returned by `callback` among the rows of the query and returns it instead of the rows.
   *
   * `callback` receives the columns and the queries of the relations of the table and returns an expression or a query of one value.
   */
  count<S extends UnaggregatedQueryState, Kind extends SelectQueryKind, E extends TypedOperand>(
    this: SelectQuery<S, Kind>,
    callback: (columns: ColumnRefs<S["table"]> & RelationRefs<S["schema"]>) => E,
  ): SelectQuery<OperandAggregateState<S, number, CountValueType, E>, Kind>
  count(arg?: unknown): unknown {
    if (arg !== undefined) {
      return this.aggregateBy("count", arg)
    }
    this.rejectAggregation("count")
    return this.deriveAggregate(countProjection)
  }

  /** Replaces the selected fields with the number of the distinct values of the column other than `NULL` among the rows of the query and returns it instead of the rows. */
  countDistinct<
    S extends UnaggregatedQueryState,
    Kind extends SelectQueryKind,
    K extends keyof S["table"]["columns"] & string,
  >(this: SelectQuery<S, Kind>, key: K): SelectQuery<CountState<S>, Kind>
  /**
   * Replaces the selected fields with the number of the distinct values other than `NULL` of the expression returned by `callback` among the rows of the query and returns it instead of the rows.
   *
   * `callback` receives the columns and the queries of the relations of the table and returns an expression or a query of one value.
   */
  countDistinct<
    S extends UnaggregatedQueryState,
    Kind extends SelectQueryKind,
    E extends TypedOperand,
  >(
    this: SelectQuery<S, Kind>,
    callback: (columns: ColumnRefs<S["table"]> & RelationRefs<S["schema"]>) => E,
  ): SelectQuery<OperandAggregateState<S, number, CountValueType, E>, Kind>
  countDistinct(arg: unknown): unknown {
    return this.aggregateBy("countDistinct", arg)
  }

  /** Replaces the selected fields with the smallest value of the column among the rows of the query and returns it instead of the rows, or `null` without values other than `NULL`. */
  min<
    S extends UnaggregatedQueryState,
    Kind extends SelectQueryKind,
    K extends keyof S["table"]["columns"] & string,
  >(this: SelectQuery<S, Kind>, key: K): SelectQuery<ColumnAggregateState<S, K>, Kind>
  /**
   * Replaces the selected fields with the smallest value of the expression returned by `callback` among the rows of the query and returns it instead of the rows, or `null` without values other than `NULL`.
   *
   * `callback` receives the columns and the queries of the relations of the table and returns an expression or a query of one value.
   */
  min<S extends UnaggregatedQueryState, Kind extends SelectQueryKind, E extends TypedOperand>(
    this: SelectQuery<S, Kind>,
    callback: (columns: ColumnRefs<S["table"]> & RelationRefs<S["schema"]>) => E,
  ): SelectQuery<OperandValueAggregateState<S, E>, Kind>
  min(arg: unknown): unknown {
    return this.aggregateBy("min", arg)
  }

  /** Replaces the selected fields with the largest value of the column among the rows of the query and returns it instead of the rows, or `null` without values other than `NULL`. */
  max<
    S extends UnaggregatedQueryState,
    Kind extends SelectQueryKind,
    K extends keyof S["table"]["columns"] & string,
  >(this: SelectQuery<S, Kind>, key: K): SelectQuery<ColumnAggregateState<S, K>, Kind>
  /**
   * Replaces the selected fields with the largest value of the expression returned by `callback` among the rows of the query and returns it instead of the rows, or `null` without values other than `NULL`.
   *
   * `callback` receives the columns and the queries of the relations of the table and returns an expression or a query of one value.
   */
  max<S extends UnaggregatedQueryState, Kind extends SelectQueryKind, E extends TypedOperand>(
    this: SelectQuery<S, Kind>,
    callback: (columns: ColumnRefs<S["table"]> & RelationRefs<S["schema"]>) => E,
  ): SelectQuery<OperandValueAggregateState<S, E>, Kind>
  max(arg: unknown): unknown {
    return this.aggregateBy("max", arg)
  }

  /** Replaces the selected fields with the sum of the values of the column among the rows of the query and returns it instead of the rows, or `null` without values other than `NULL`. */
  sum<
    S extends UnaggregatedQueryState,
    Kind extends SelectQueryKind,
    K extends keyof S["table"]["columns"] & string,
  >(this: SelectQuery<S, Kind>, key: K): SelectQuery<ColumnAggregateState<S, K>, Kind>
  /**
   * Replaces the selected fields with the sum of the values of the expression returned by `callback` among the rows of the query and returns it instead of the rows, or `null` without values other than `NULL`.
   *
   * `callback` receives the columns and the queries of the relations of the table and returns an expression or a query of one value.
   */
  sum<S extends UnaggregatedQueryState, Kind extends SelectQueryKind, E extends TypedOperand>(
    this: SelectQuery<S, Kind>,
    callback: (columns: ColumnRefs<S["table"]> & RelationRefs<S["schema"]>) => E,
  ): SelectQuery<OperandValueAggregateState<S, E>, Kind>
  sum(arg: unknown): unknown {
    return this.aggregateBy("sum", arg)
  }

  /** Replaces the selected fields with the average of the values of the column among the rows of the query and returns it instead of the rows, or `null` without values other than `NULL`; for `bigint` values, average an expression of a type that can represent fractional values. */
  avg<
    S extends UnaggregatedQueryState,
    Kind extends SelectQueryKind,
    K extends keyof S["table"]["columns"] & string,
  >(this: SelectQuery<S, Kind>, key: K): SelectQuery<ColumnAggregateState<S, K>, Kind>
  /**
   * Replaces the selected fields with the average of the values of the expression returned by `callback` among the rows of the query and returns it instead of the rows, or `null` without values other than `NULL`; for `bigint` values, average an expression of a type that can represent fractional values.
   *
   * `callback` receives the columns and the queries of the relations of the table and returns an expression or a query of one value.
   */
  avg<S extends UnaggregatedQueryState, Kind extends SelectQueryKind, E extends TypedOperand>(
    this: SelectQuery<S, Kind>,
    callback: (columns: ColumnRefs<S["table"]> & RelationRefs<S["schema"]>) => E,
  ): SelectQuery<OperandValueAggregateState<S, E>, Kind>
  avg(arg: unknown): unknown {
    return this.aggregateBy("avg", arg)
  }

  /** Replaces the selected fields with whether every value of the Boolean column other than `NULL` among the rows of the query is true and returns it instead of the rows, or `null` without such values. */
  every<
    S extends UnaggregatedQueryState,
    Kind extends SelectQueryKind,
    K extends keyof S["table"]["columns"] & string,
  >(this: SelectQuery<S, Kind>, key: K): SelectQuery<ColumnAggregateState<S, K>, Kind>
  /**
   * Replaces the selected fields with whether every value other than `NULL` of the Boolean expression returned by `callback` among the rows of the query is true and returns it instead of the rows, or `null` without such values.
   *
   * `callback` receives the columns and the queries of the relations of the table and returns an expression or a query of one value.
   */
  every<S extends UnaggregatedQueryState, Kind extends SelectQueryKind, E extends TypedOperand>(
    this: SelectQuery<S, Kind>,
    callback: (columns: ColumnRefs<S["table"]> & RelationRefs<S["schema"]>) => E,
  ): SelectQuery<OperandValueAggregateState<S, E>, Kind>
  every(arg: unknown): unknown {
    return this.aggregateBy("every", arg)
  }

  /** Replaces the selected fields with whether any value of the Boolean column among the rows of the query is true and returns it instead of the rows, or `null` without values other than `NULL`. */
  some<
    S extends UnaggregatedQueryState,
    Kind extends SelectQueryKind,
    K extends keyof S["table"]["columns"] & string,
  >(this: SelectQuery<S, Kind>, key: K): SelectQuery<ColumnAggregateState<S, K>, Kind>
  /**
   * Replaces the selected fields with whether any value of the Boolean expression returned by `callback` among the rows of the query is true and returns it instead of the rows, or `null` without values other than `NULL`.
   *
   * `callback` receives the columns and the queries of the relations of the table and returns an expression or a query of one value.
   */
  some<S extends UnaggregatedQueryState, Kind extends SelectQueryKind, E extends TypedOperand>(
    this: SelectQuery<S, Kind>,
    callback: (columns: ColumnRefs<S["table"]> & RelationRefs<S["schema"]>) => E,
  ): SelectQuery<OperandValueAggregateState<S, E>, Kind>
  some(arg: unknown): unknown {
    return this.aggregateBy("some", arg)
  }

  /** Replaces the selected fields with the values of the text column other than `NULL` among the rows of the query, joined with `delimiter` in the order of the query, and returns them instead of the rows, or `null` without such values. */
  stringAgg<
    S extends UnaggregatedQueryState,
    Kind extends SelectQueryKind,
    K extends keyof S["table"]["columns"] & string,
  >(
    this: SelectQuery<S, Kind>,
    key: K,
    delimiter: string,
  ): SelectQuery<ColumnAggregateState<S, K>, Kind>
  /**
   * Replaces the selected fields with the values other than `NULL` of the text expression returned by `callback` among the rows of the query, joined with `delimiter` in the order of the query, and returns them instead of the rows, or `null` without such values.
   *
   * `callback` receives the columns and the queries of the relations of the table and returns an expression or a query of one value.
   */
  stringAgg<S extends UnaggregatedQueryState, Kind extends SelectQueryKind, E extends TypedOperand>(
    this: SelectQuery<S, Kind>,
    callback: (columns: ColumnRefs<S["table"]> & RelationRefs<S["schema"]>) => E,
    delimiter: string,
  ): SelectQuery<OperandValueAggregateState<S, E>, Kind>
  stringAgg(arg: unknown, delimiter: string): unknown {
    return this.aggregateBy("stringAgg", arg, delimiter)
  }

  // Like an aggregate query, it always has its row, so no relation needs to guarantee it, and a filter keeps its rows mode.
  /**
   * Replaces the selected fields with whether the query has a row and returns it instead of the rows, such as to filter by related records in `where`.
   *
   * It keeps the filters, the limit, and the offset, and ignores the order; after `groupBy`, it tells whether the query has a group.
   */
  exists<S extends UnaggregatedQueryState, Kind extends SelectQueryKind>(
    this: SelectQuery<S, Kind>,
  ): SelectQuery<AggregateState<S, boolean, ExistsValueType>, Kind>
  exists(): unknown {
    this.rejectAggregation("exists")
    return this.deriveAggregate(getExistsProjection())
  }

  /**
   * Replaces a `NULL` value of a query of values, such as one made by `get`, `pluck`, or an aggregate, with `fallback`, such as `0` for a sum without rows.
   *
   * `fallback` is a value that the type of the value accepts, an expression of its values, such as a column of the row of a parent query, or a query of one such value.
   * A missing row stays missing: an optional query still resolves to `undefined` without a row.
   */
  coalesce<
    S extends CoalesceQueryState,
    Kind extends SelectQueryKind,
    F extends Operand<S["result"], S["valueType"]["input"]>,
  >(
    this: SelectQuery<S, Kind>,
    fallback: F,
  ): SelectQuery<ChangeState<S, { result: CoalescedValue<S["result"], F> }>, Kind>
  coalesce(fallback: unknown): unknown {
    this.rejectMapped("coalesce")
    const { node } = this
    if (!node.value) {
      throw new Error(
        "coalesce applies only to a query of values, such as one made by get, pluck, or an aggregate",
      )
    }
    return this.derive({
      projections: [coalesceValue(node.projections[0] as ScalarProjection, fallback)],
    })
  }

  /**
   * Returns an expression of the value of a query of one value, such as of `get` or of an aggregate, with the operators of its type, such as `form.fields.count().expr().gt(3)`.
   *
   * Without a row, the expression is `NULL`, and the query does not reject.
   */
  expr<Q extends QueryOf<ExpressionQueryState>>(
    this: Q,
  ): Expression<
    ScalarQueryValue<Q>,
    Q["types"]["valueType"]["operators"],
    Q["types"]["valueType"]["input"]
  >
  expr(): unknown {
    // The method of `operandNode` rejects a query other than of one value, whose only projection has the type of the value.
    const value = this[operandNode]()
    return toExpression(value, (this.node.projections[0] as ScalarProjection).type)
  }

  // It keeps the state, as `orderBy` and `distinct` do: types cannot tell which columns a key makes valid, such as the other columns of a primary key, so that a part of the state for it would cost every query and decide nothing.
  /**
   * Groups the rows by the keys returned by `callback`, after the keys of earlier calls, so that the query gives one row of each group, whose fields are its keys and the aggregates of its rows, such as `sum(field.position)`.
   *
   * `callback` receives the columns with the queries of the relations of the table, and the fields selected so far, and returns an expression or a query of one value, or an array of them.
   * A selected field groups by the value of the field; a field of nested rows or of a literal cannot be grouped by.
   * Methods that choose rows and read values, such as `limit`, `take`, and `pluck`, apply to the groups, and an aggregate method aggregates them, such as `count` for the number of the groups.
   * The query cannot take a row lock, `update`, or `delete`.
   */
  groupBy<Q extends QueryOf<RecordQueryState>>(
    this: Q,
    callback: (
      // An intersection rather than one alias of both, as for the callback of `select`.
      columns: ColumnRefs<Q["types"]["table"]> & RelationRefs<Q["types"]["schema"]>,
      selected: SelectedRefs<Q["types"]["result"]>,
    ) => GroupTerms,
  ): Q
  /**
   * Groups the rows of a query made by `get` or `pluck` by the keys returned by `callback`, after the keys of earlier calls.
   *
   * `callback` receives the columns with the queries of the relations of the table, and the expression of the value, and returns what `groupBy` of a query of records takes.
   */
  groupBy<Q extends QueryOf<UnaggregatedValueQueryState>>(
    this: Q,
    callback: (
      columns: ColumnRefs<Q["types"]["table"]> & RelationRefs<Q["types"]["schema"]>,
      value: AnyExpression<Q["types"]["result"]>,
    ) => GroupTerms,
  ): Q
  /** Groups the rows by the listed columns, after the keys of earlier calls, so that the query gives one row of each group, whose fields are its keys and the aggregates of its rows, such as `sum(field.position)`. */
  groupBy<Q extends QueryOf<UnaggregatedQueryState>>(
    this: Q,
    ...keys: (keyof Q["types"]["table"]["columns"] & string)[]
  ): Q
  groupBy(...args: unknown[]): unknown {
    this.rejectAggregate("groupBy")
    if (this.node.lock !== undefined) {
      throw new Error(
        "groupBy cannot be used after a row lock, since a group comes from several rows of the table",
      )
    }
    return this.derive({ groupBy: addGroupKeys("groupBy", this.node, this.context, args) })
  }

  // A query whose row no relation guarantees keeps its state, as for `where`.
  /** Filters the groups of a query of `groupBy` by what `where` takes, such as an aggregate of a group, combined with `AND` with the previous conditions of the groups; `where` keeps filtering the rows of the groups. */
  having<Q extends QueryOf<UnguaranteedQueryState>>(
    this: Q,
    filter: QueryWhereFilter<Q["types"]>,
  ): Q
  /**
   * Filters the groups of a query of `groupBy` by what `where` takes, such as an aggregate of a group, combined with `AND` with the previous conditions of the groups; `where` keeps filtering the rows of the groups.
   *
   * A query of the record of a required relation, such as `field.form`, resolves to `null` without a group that passes the filter, or to `undefined` after `get` or `pluck`.
   */
  having<S extends SelectQueryState, Kind extends SelectQueryKind>(
    this: SelectQuery<S, Kind>,
    filter: QueryWhereFilter<S>,
  ): SelectQuery<FilteredState<S>, Kind>
  having(filter: WhereFilter<AnyTable>): unknown {
    return this.derive({
      having: addHaving(this.node, filter, this.context),
      rows: this.getFilteredRows(),
      guaranteed: false,
    })
  }

  /**
   * Sorts the rows by the sort keys returned by `callback`, after the sort keys of earlier calls.
   *
   * `callback` receives the columns with the queries of the relations of the table, and the fields selected so far.
   * It returns an expression or a query of one value, such as of an aggregate of related records, sorted in ascending order, `asc`, `desc`, or `orderBy` of one, or an array of them.
   * A selected field sorts by the value of the field, also when it changes from row to row, such as `random()`; a field of nested rows cannot be sorted by.
   */
  orderBy<Q extends QueryOf<RecordQueryState>>(
    this: Q,
    callback: (
      // An intersection rather than one alias of both, as for the callback of `select`.
      columns: ColumnRefs<Q["types"]["table"]> & RelationRefs<Q["types"]["schema"]>,
      selected: SelectedRefs<Q["types"]["result"]>,
    ) => OrderTerms,
  ): Q
  /**
   * Sorts the values of a query made by `get` or `pluck` by the sort keys returned by `callback`, after the sort keys of earlier calls.
   *
   * `callback` receives the columns with the queries of the relations of the table, and the expression of the value.
   * It returns an expression or a query of one value, sorted in ascending order, `asc`, `desc`, or `orderBy` of one, or an array of them.
   */
  orderBy<Q extends QueryOf<ValueQueryState>>(
    this: Q,
    callback: (
      columns: ColumnRefs<Q["types"]["table"]> & RelationRefs<Q["types"]["schema"]>,
      value: AnyExpression<Q["types"]["result"]>,
    ) => OrderTerms,
  ): Q
  /**
   * Sorts the rows of a query that `map` converts by the sort keys returned by `callback`, after the sort keys of earlier calls.
   *
   * `callback` receives the columns with the queries of the relations of the table, and returns what `orderBy` of a query of records takes.
   */
  orderBy<Q extends QueryOf<MappedQueryState>>(
    this: Q,
    callback: (
      columns: ColumnRefs<Q["types"]["table"]> & RelationRefs<Q["types"]["schema"]>,
    ) => OrderTerms,
  ): Q
  /** Sorts the rows by the listed columns in ascending order, or in the directions of objects of columns, after the sort keys of earlier calls. */
  orderBy<Q extends AnySelectQuery>(this: Q, ...keys: OrderKey<Q["types"]["table"]>[]): Q
  orderBy(...args: unknown[]): unknown {
    return this.derive({ orderBy: addOrder(this.node, this.context, args) })
  }

  /** Returns at most `count` rows of a query of many rows, replacing an earlier limit. */
  limit<Q extends QueryOf<ManyRowsQueryState>>(this: Q, count: number): Q
  limit(count: number): unknown {
    return this.derive({ limit: createPageCount(this.node, "limit", count) })
  }

  /** Skips the first `count` rows of a query of many rows, replacing an earlier offset. */
  offset<Q extends QueryOf<ManyRowsQueryState>>(this: Q, count: number): Q
  offset(count: number): unknown {
    return this.derive({ offset: createPageCount(this.node, "offset", count) })
  }

  // It keeps the state, as `orderBy` and `limit` do, so that a conditional call can assign the query back to its variable and gives no union of states that `select` rejects.
  /**
   * Removes the duplicate rows of a query of many rows, such as of `pluck` for `in`, comparing the fields that the query selects, also those selected after it.
   *
   * Sort the query only by its selected fields.
   * The query cannot select nested rows, which `distinct` cannot compare.
   * The aggregate methods and `exists` reject the query after it, since they replace the fields that it compares; `countDistinct` counts distinct values.
   */
  distinct<Q extends QueryOf<ManyRowsQueryState>>(this: Q): Q
  distinct(): unknown {
    // Rows `one` must find a second row to reject it, which `distinct` could hide, as a limit would.
    if (this.node.rows !== "many") {
      throw new Error("distinct applies only to a query of many rows")
    }
    if (this.node.distinctOn.length > 0) {
      throw new Error("distinct cannot be used after distinctOn, which compares only its keys")
    }
    if (this.node.lock !== undefined) {
      throw new Error(
        "distinct cannot be used after a row lock, since a row without duplicates comes from several rows of the table",
      )
    }
    return this.derive({ distinct: true })
  }

  // It keeps the state, as `distinct` and `groupBy` do, so that a conditional call can assign the query back to its variable.
  /**
   * Keeps the first row of each group of the rows of a query of many rows with equal values of the keys returned by `callback`, after the keys of earlier calls, such as the latest submission of each user.
   *
   * `callback` receives the columns with the queries of the relations of the table, and the fields selected so far, and returns an expression or a query of one value, or an array of them; a field of nested rows or of a literal cannot be a key.
   * Sort the query by the keys first, then by the order that chooses the first row of each group; the rows keep that order.
   * To sort by a key of an expression, select it and take it from the second parameter of the callbacks of `distinctOn` and `orderBy`.
   * The aggregate methods and `exists` reject the query after it.
   */
  distinctOn<Q extends QueryOf<RecordQueryState & ManyRowsQueryState>>(
    this: Q,
    callback: (
      // An intersection rather than one alias of both, as for the callback of `select`.
      columns: ColumnRefs<Q["types"]["table"]> & RelationRefs<Q["types"]["schema"]>,
      selected: SelectedRefs<Q["types"]["result"]>,
    ) => GroupTerms,
  ): Q
  /**
   * Keeps the first value of each group of the values of a query made by `pluck` with equal values of the keys returned by `callback`, after the keys of earlier calls.
   *
   * `callback` receives the columns with the queries of the relations of the table, and the expression of the value, and returns what `distinctOn` of a query of records takes.
   */
  distinctOn<Q extends QueryOf<ValueQueryState & ManyRowsQueryState>>(
    this: Q,
    callback: (
      columns: ColumnRefs<Q["types"]["table"]> & RelationRefs<Q["types"]["schema"]>,
      value: AnyExpression<Q["types"]["result"]>,
    ) => GroupTerms,
  ): Q
  /**
   * Keeps the first row of each group of the rows of a query that `map` converts with equal values of the keys returned by `callback`, after the keys of earlier calls.
   *
   * `callback` receives the columns with the queries of the relations of the table, and returns what `distinctOn` of a query of records takes.
   */
  distinctOn<Q extends QueryOf<MappedQueryState & ManyRowsQueryState>>(
    this: Q,
    callback: (
      columns: ColumnRefs<Q["types"]["table"]> & RelationRefs<Q["types"]["schema"]>,
    ) => GroupTerms,
  ): Q
  /**
   * Keeps the first row of each group of the rows of a query of many rows with equal values of the listed columns, after the keys of earlier calls, such as the latest submission of each user.
   *
   * Sort the query by the keys first, then by the order that chooses the first row of each group; the rows keep that order.
   */
  distinctOn<Q extends QueryOf<ManyRowsQueryState>>(
    this: Q,
    ...keys: (keyof Q["types"]["table"]["columns"] & string)[]
  ): Q
  distinctOn(...args: unknown[]): unknown {
    const { node } = this
    // Rows `one` must find a second row to reject it, which `distinctOn` could hide, as `distinct` could.
    if (node.rows !== "many") {
      throw new Error("distinctOn applies only to a query of many rows")
    }
    if (node.distinct) {
      throw new Error(
        "distinctOn cannot be used after distinct, which compares every selected field",
      )
    }
    if (node.lock !== undefined) {
      throw new Error(
        "distinctOn cannot be used after a row lock; PostgreSQL does not allow row locks with DISTINCT ON",
      )
    }
    return this.derive({ distinctOn: addGroupKeys("distinctOn", node, this.context, args) })
  }

  // They keep the state, as `distinct` does, so that a conditional call can assign the query back to its variable.
  /**
   * Locks the rows of the query until its transaction ends, so that code can read a row and then update it based on the values it read: another transaction waits to change or lock them.
   *
   * It replaces an earlier lock of the query, and reaches no other query: lock the records of a nested query by calling it there.
   * Without `options`, the query waits for the rows that another transaction has locked.
   *
   * It requires a transaction, unless the query is part of a mutation, such as of its filter.
   * The query cannot use `distinct`, `distinctOn`, or `groupBy`, and the aggregate methods and `exists` reject it after the lock.
   */
  forUpdate<Q extends QueryOf<LockableQueryState>>(this: Q, options?: RowLockOptions): Q
  forUpdate(options?: RowLockOptions): unknown {
    return this.derive({ lock: createRowLock(this.node, "forUpdate", "UPDATE", options) })
  }

  /**
   * Locks the rows of the query as `forUpdate` does, but lets other transactions insert records that refer to them.
   *
   * Use it when the transaction only updates columns outside the keys of the rows.
   */
  forNoKeyUpdate<Q extends QueryOf<LockableQueryState>>(this: Q, options?: RowLockOptions): Q
  forNoKeyUpdate(options?: RowLockOptions): unknown {
    return this.derive({
      lock: createRowLock(this.node, "forNoKeyUpdate", "NO KEY UPDATE", options),
    })
  }

  /** Keeps the rows of the query from changing until its transaction ends, as `forUpdate` does, while other transactions read and share-lock them too. */
  forShare<Q extends QueryOf<LockableQueryState>>(this: Q, options?: RowLockOptions): Q
  forShare(options?: RowLockOptions): unknown {
    return this.derive({ lock: createRowLock(this.node, "forShare", "SHARE", options) })
  }

  /** Keeps the rows of the query from being deleted or changing their keys until its transaction ends, as `forUpdate` does, while other transactions change their other columns. */
  forKeyShare<Q extends QueryOf<LockableQueryState>>(this: Q, options?: RowLockOptions): Q
  forKeyShare(options?: RowLockOptions): unknown {
    return this.derive({ lock: createRowLock(this.node, "forKeyShare", "KEY SHARE", options) })
  }

  /** Makes a query of one row, such as one of `take` or `get`, resolve to `undefined` without a row. */
  optional<S extends OneRowQueryState, Kind extends SelectQueryKind>(
    this: SelectQuery<S, Kind>,
  ): SelectQuery<ChangeState<S, { rows: "optional"; guaranteed: false }>, Kind>
  optional(): unknown {
    return this.changeOneRow("optional", "optional")
  }

  /**
   * Makes a query of one record, such as one of `take`, resolve to `null` without a row.
   *
   * A value of `get` or `pluck` is never `null` for a missing row, which would read as a `NULL` value, so a query of values does not accept it, unless `map` converts them, and after `get` or `pluck` the query resolves to `undefined` without a row.
   */
  nullable<S extends OneRecordQueryState, Kind extends SelectQueryKind>(
    this: SelectQuery<S, Kind>,
  ): SelectQuery<ChangeState<S, { rows: "nullable"; guaranteed: false }>, Kind>
  nullable(): unknown {
    // The result of `map` is no value of a column, so `null` does not read as `NULL`.
    if (this.node.value && this.node.conversion === undefined) {
      throw new Error(
        "nullable applies only to a query of records; use optional after get, pluck, or an aggregate",
      )
    }
    return this.changeOneRow("nullable", "nullable")
  }

  /** Makes a query of one row, such as one of `optional` or `nullable`, reject without a row. */
  required<S extends OneRowQueryState, Kind extends SelectQueryKind>(
    this: SelectQuery<S, Kind>,
  ): SelectQuery<ChangeState<S, { rows: "one"; guaranteed: false }>, Kind>
  required(): unknown {
    return this.changeOneRow("required", "one")
  }

  /**
   * Inserts a record into the table of a query without clauses, such as a table of a `Db`, and resolves to the number of the inserted rows, `1`.
   *
   * A column omitted or given as `undefined` gets its default, so only columns marked with `hasDefault` and nullable columns may be omitted.
   * A value is what the type of its column takes, `null` for `NULL`, an expression, such as a `sql` fragment, or a query of one value, which gives `NULL` without its row.
   * Select the fields that it returns after it, such as `insert(values).get("id")`.
   */
  insert<S extends SelectQueryState, Kind extends SelectQueryKind>(
    this: SelectQuery<S, Kind>,
    values: InsertValues<S["table"]>,
  ): MutationQuery<InitialMutationState<S["table"], S["schema"], "one">, Kind>
  insert(values: unknown): unknown {
    return createInsert(this, [values], "one", "insert")
  }

  /**
   * Inserts records into the table of a query without clauses, such as a table of a `Db`, in one statement, and resolves to the number of the inserted rows.
   *
   * A record takes the values that `insert` takes, and a column that a record omits gets its default.
   * Select the fields that it returns for the inserted rows after it, such as `insertMany(records).select("id", "email")`, and match them to the records by a key rather than by their order, which PostgreSQL does not guarantee.
   */
  insertMany<S extends SelectQueryState, Kind extends SelectQueryKind>(
    this: SelectQuery<S, Kind>,
    records: readonly InsertValues<S["table"]>[],
  ): MutationQuery<InitialMutationState<S["table"], S["schema"], "many">, Kind>
  insertMany(records: readonly unknown[]): unknown {
    if (!Array.isArray(records)) {
      throw new TypeError("insertMany takes an array of records")
    }
    return createInsert(this, records, "many", "insertMany")
  }

  // Overloads rather than one signature that infers the values of a callback, which costs about 10% more for a callback.
  // The last overload takes a callback too, so that a call that matches no overload reports the error of its own form, and a value of `UpdateSet` applies.
  // It records no relations, as an object of values does not.
  // The first overload infers the callback rather than its values: the constraint of the callback types its body by the columns of the table, whereas a type parameter of the values would widen a literal of a column, such as of an enum, to `string` for every overload.
  // It costs less than a conditional type of a callback that infers its values, as `QueryWhereFilter` is for `where`.
  /**
   * Updates the rows that the filters of the query choose with the values that `callback` returns, and resolves to the number of the updated rows.
   *
   * `callback` receives the columns and the queries of the relations of the changed rows, such as to set a column from another one or from related records, and returns the values of the columns to update; a column omitted or given as `undefined` keeps its value.
   * A value is what `insert` takes as a value, such as a query of an aggregate of related records.
   * A query of `find` or `findBy` rejects with `NotFoundError` without its row, unless `optional` or `nullable` allows it.
   * A query without a filter must call `all` to update every row.
   * Select the fields that it returns after it, with their values after the update, such as `update(callback).select("id")`.
   */
  update<
    S extends SelectQueryState,
    Kind extends SelectQueryKind,
    F extends (
      columns: ColumnRefs<S["table"]> & RelationRefs<S["schema"]>,
    ) => UpdateValues<S["table"]>,
  >(
    this: SelectQuery<S, Kind>,
    callback: F,
  ): MutationQuery<
    InitialMutationState<
      S["table"],
      S["schema"],
      S["rows"],
      OperandUses<ReturnType<F>[keyof ReturnType<F>]>
    >,
    Kind
  >
  /**
   * Updates the rows that the filters of the query choose with the values of `set`, and resolves to the number of the updated rows.
   *
   * `set` gives the values of the columns to update, or is a callback that returns them; a column omitted or given as `undefined` keeps its value.
   * A value is what `insert` takes as a value.
   * A query of `find` or `findBy` rejects with `NotFoundError` without its row, unless `optional` or `nullable` allows it.
   * A query without a filter must call `all` to update every row.
   * Select the fields that it returns after it, with their values after the update, such as `update(set).select("id")`.
   */
  update<S extends SelectQueryState, Kind extends SelectQueryKind>(
    this: SelectQuery<S, Kind>,
    set: UpdateSet<S["table"], S["schema"]>,
  ): MutationQuery<InitialMutationState<S["table"], S["schema"], S["rows"]>, Kind>
  update(set: unknown): unknown {
    return createUpdate(this, set)
  }

  /**
   * Deletes the rows that the filters of the query choose, and resolves to the number of the deleted rows.
   *
   * A query of `find` or `findBy` rejects with `NotFoundError` without its row, unless `optional` or `nullable` allows it.
   * A query without a filter must call `all` to delete every row.
   * Select the fields that it returns after it, such as `delete().pluck("id")`.
   */
  delete<S extends SelectQueryState, Kind extends SelectQueryKind>(
    this: SelectQuery<S, Kind>,
  ): MutationQuery<InitialMutationState<S["table"], S["schema"], S["rows"]>, Kind>
  delete(): unknown {
    return createDelete(this)
  }

  /** Allows `update` and `delete` to change every row of the table when the query has no filter; it changes nothing else. */
  all<Q extends QueryOf<ManyRowsQueryState>>(this: Q): Q
  all(): unknown {
    if (this.node.rows !== "many") {
      throw new Error("all applies only to a query of many rows")
    }
    return this.derive({ all: true })
  }

  /**
   * Converts each record or value of the result in code, after decoding, executed or nested, such as to add a field that SQL cannot compute.
   *
   * `callback` receives one record or value, also `null` of a `NULL` value, and is not called for a missing row, so an optional query still resolves to `undefined` without a row; it returns its result synchronously.
   * The SQL stays as it is, so the methods that read the fields, such as `select` and `count`, and expressions reject the query after it, whereas `where`, `orderBy`, `limit`, `take`, and further `map` apply.
   * A failure of `callback` rejects with `ResultDecodeError`, whose cause is the error.
   */
  map<S extends SelectQueryState, Kind extends SelectQueryKind, R>(
    this: SelectQuery<S, Kind>,
    callback: (row: S["result"]) => R & SynchronousResult<R>,
  ): SelectQuery<ChangeState<S, { result: R; value: "mapped"; aggregate: true }>, Kind>
  map(callback: (row: unknown) => unknown): unknown {
    return this.derive({ conversion: addMap(this.node.conversion, callback) })
  }

  /**
   * Converts the whole result in code, after decoding, executed or nested, such as to group rows or to compute a value from them.
   *
   * `callback` receives what the query resolves to, once: the array of rows, one row, or `null` or `undefined` of a missing row of a nullable or optional query; it returns its result synchronously.
   * The SQL stays as it is, so call it last: the returned query only executes, nests in a selection, and takes further `transform`.
   * A failure of `callback` rejects with `ResultDecodeError`, whose cause is the error.
   */
  transform<S extends SelectQueryState, Kind extends SelectQueryKind, R>(
    this: SelectQuery<S, Kind>,
    callback: (result: QueryResult<S>) => R & SynchronousResult<R>,
  ): TransformedQuery<TransformedQueryState<S["table"], R, S["uses"]>, Kind>
  transform(callback: (result: unknown) => unknown): unknown {
    return transformQuery(this.node, this.db as AnyDb | undefined, callback)
  }

  // The result is constrained to the kind of this query, so a callback cannot change the binding, and a Promise or another value is rejected.
  // A state of `any` spares comparing the state of every result with `SelectQueryState` member by member.
  /**
   * Returns the query that `callback` builds from this query, such as one with a conditional clause, or that a helper of `defineHelper` builds with `args`.
   *
   * `callback` receives this query and `args` and returns this query or a query derived from it, which keeps the binding of this query.
   */
  use<
    Q,
    Kind extends SelectQueryKind,
    // oxlint-disable-next-line typescript/no-explicit-any -- a query of any state of this kind
    R extends SelectQuery<any, Kind>,
    A extends unknown[] = [],
  >(
    // The whole query, so that the callback receives a union of queries as it is, and its kind.
    // oxlint-disable-next-line typescript/no-explicit-any -- the kind of a query of any state
    this: Q & SelectQuery<any, Kind>,
    callback: (query: Q, ...args: A) => R,
    ...args: A
  ): R
  use(
    callback: (query: AnySelectQuery, ...args: unknown[]) => unknown,
    ...args: unknown[]
  ): unknown {
    return requireDerived(this, callback(this, ...args), "The callback of use")
  }

  /**
   * Compiles the query into SQL text and parameters; `schemaName` qualifies its tables.
   *
   * A query bound to a `Db` compiles as the `Db` executes it, with the PostgreSQL schema of the `Db`, and rejects options.
   */
  toSQL(...args: ToSQLArgs<Kind>): SqlStatement
  toSQL(options?: CompileOptions): SqlStatement {
    return compileToSQL(this, options)
  }

  /**
   * Returns the node of the query as an operand of an expression, which lowering replaces with a scalar subquery of its value, or with `EXISTS` of its rows for a query of `exists`.
   *
   * It rejects a query of records or of rows `many`, which `ScalarQuery` rejects in types.
   */
  [operandNode](): ExpressionNode {
    const { node } = this
    if (!node.value || node.rows === "many") {
      throw new TypeError(
        "An expression takes a query of one value, such as of get, an aggregate, or exists, not a query of records or of an array",
      )
    }
    // SQL reads the value without its conversion.
    if (node.conversion !== undefined) {
      throw new TypeError(
        "An expression takes a query of one value, such as of get, an aggregate, or exists, not a query of map",
      )
    }
    return createNode({ kind: "nestedQuery", query: node, db: this.db as AnyDb | undefined })
  }

  /**
   * Returns the node of the query as the values of `in`, which lowering replaces with its statement.
   *
   * It rejects a query of records, which `ValuesQuery` rejects in types.
   */
  [valuesQueryNode](): NestedQueryNode {
    const { node } = this
    if (!node.value) {
      throw new TypeError("in takes a query of values, such as of pluck, not a query of records")
    }
    if (node.conversion !== undefined) {
      throw new TypeError("in takes a query of values, such as of pluck, not a query of map")
    }
    return createNode({ kind: "nestedQuery", query: node, db: this.db as AnyDb | undefined })
  }

  /** Creates a query of the same kind and `Db` with the node changes applied. */
  private derive(changes: Partial<QueryNode>): AnySelectQuery {
    return new SelectQuery(
      this.table,
      Object.freeze({ ...this.node, ...changes }),
      this.context,
      this.db as AnyDb | undefined,
    )
  }

  /**
   * Creates a query of the same kind and `Db` with the node changes applied and then those of `take`, in one derived query.
   *
   * It adds the changes of `take` to `changes`, which must leave the limit as it is.
   */
  private deriveTaken(changes: NodeChanges): AnySelectQuery {
    if ((changes.rows ?? this.node.rows) === "many") {
      changes.limit = limitToOne(this.node.limit)
      changes.rows = "one"
    }
    return this.derive(changes)
  }

  /** Creates the query of the value of `projection`, of an aggregate or of `exists` over the rows of this query, which always returns one row. */
  private deriveAggregate(projection: ScalarProjection): AnySelectQuery {
    return this.derive({ projections: [projection], rows: "one", value: true, guaranteed: false })
  }

  /** Creates the query of the aggregate of `method` over `arg`, a column key or a callback that receives the columns and the relations and returns an expression or a query of one value; `delimiter` is the delimiter of `stringAgg`. */
  private aggregateBy(method: AggregateMethod, arg: unknown, delimiter?: string): AnySelectQuery {
    this.rejectAggregation(method)
    return this.deriveAggregate(
      projectAggregate(method, projectValue(this.node.from, arg, method, this.context), delimiter),
    )
  }

  /** Returns the changes of the node that add `filter` with `AND`, ending the guarantee of the row as `FilteredState` does in types. */
  private addFilter(filter: WhereFilter<AnyTable>): NodeChanges {
    const { node } = this
    return {
      filters: addUserFilter(node.filters, filter, node.from, this.context),
      rows: this.getFilteredRows(),
      guaranteed: false,
    }
  }

  /** Returns the rows mode of this query after a filter, as `FilteredStateRows` gives it in types. */
  private getFilteredRows(): ResultRows {
    const { node } = this
    // The result of `map` is no value of a column, so a query of values that it converts turns `one` into `nullable`.
    return toFilteredRows(node.rows, node.value && node.conversion === undefined, node.guaranteed)
  }

  // The values of a key match at most one row, so a query of many rows becomes a query of rows `one` without a limit, which rejects several rows, such as where the database lacks the key or a value depends on the row, as a relation `one` does.
  // Without a limit, a mutation tells a query of `find` from one of `take`, whose rows it cannot limit.
  /** Creates the query of `find` and `findBy`: `where` of `values`, an object of column values, returning one row like `take`. */
  private takeWhere(values: Record<string, unknown>): AnySelectQuery {
    const changes = this.addFilter(values)
    if (changes.rows === "many") {
      changes.rows = "one"
    }
    return this.derive(changes)
  }

  /** Creates the query of one row with rows mode `rows` that `method` returns, rejecting a query of many rows. */
  private changeOneRow(method: string, rows: ResultRows): AnySelectQuery {
    if (this.node.rows === "many") {
      throw new Error(`${method} applies only to a query of one row, such as one made by take`)
    }
    return this.derive({ rows, guaranteed: false })
  }

  // The callback of `map` reads the fields of the query, so a change of them would change what it receives.
  /** Rejects `method`, which reads or changes the fields of the query, on a query that `map` converts. */
  private rejectMapped(method: string): void {
    if (this.node.conversion !== undefined) {
      throw new Error(`${method} cannot be used after map; call it before map`)
    }
  }

  /** Rejects a change of the selection by `method` of a query made by `get`, `pluck`, or an aggregate method. */
  private rejectValue(method: string): void {
    this.rejectMapped(method)
    if (!this.node.value) {
      return
    }
    this.rejectAggregate(method)
    throw new Error(
      `${method} cannot be used after get or pluck; call get or pluck to replace the value`,
    )
  }

  // An aggregate query has rows `one` over the aggregated rows without a limit, so a value of a row would decode several rows as one, and another aggregate would aggregate those rows rather than the row of the aggregate; so does a query of `exists`.
  /** Rejects `method`, which replaces the value or the selection, on a query made by an aggregate method or `exists`. */
  private rejectAggregate(method: string): void {
    this.rejectMapped(method)
    const { node } = this
    if (isAggregateQuery(node)) {
      throw new Error(`${method} cannot be used after an aggregate`)
    }
    if (isExistsQuery(node)) {
      throw new Error(`${method} cannot be used after exists`)
    }
  }

  // They replace the fields that `distinct` compares, so nothing tells which rows they would read.
  // An aggregate of the first rows of `distinctOn` would need a derived source of them, which lowering builds only for nested queries.
  // PostgreSQL rejects a lock beside an aggregate, and `EXISTS` would lock only the first row that it finds.
  /** Rejects `method`, an aggregate method or `exists`, on a query made by one of them, of `distinct` or `distinctOn`, or with a row lock. */
  private rejectAggregation(method: string): void {
    this.rejectAggregate(method)
    if (this.node.distinct) {
      throw new Error(
        `${method} cannot be used after distinct, whose selected fields it replaces; to count distinct values, call countDistinct without distinct`,
      )
    }
    if (this.node.distinctOn.length > 0) {
      throw new Error(`${method} cannot be used after distinctOn`)
    }
    if (this.node.lock !== undefined) {
      throw new Error(
        `${method} cannot be used after a row lock, since it returns no rows of the table to lock`,
      )
    }
  }
}

/** Select query bound to a `Db`, executed by awaiting it; every method returns a query bound to the same `Db`. */
export type BoundSelectQuery<S extends SelectQueryState> = SelectQuery<S, "bound">

/**
 * Returns `result`, which a callback named by `subject` returned for `query`, a query of a table or a mutation, after checking that it is `query` or a query of the same class derived from it.
 *
 * An ancestor of `query` also passes, since only the source occurrence is compared.
 */
export function requireDerived<R>(
  query: AnySelectQuery | AnyMutationQuery,
  result: R,
  subject: string,
): R {
  // A query derived from `query` keeps its source occurrence and its `Db`.
  const derived =
    query instanceof SelectQuery
      ? result instanceof SelectQuery && result.node.from === query.node.from
      : result instanceof MutationQuery && result.node.target === query.node.target
  if (!derived) {
    throw new Error(`${subject} must return the query it receives or one derived from it`)
  }
  return result
}

/** Select query of any state and kind. */
// oxlint-disable-next-line typescript/no-explicit-any -- any select query regardless of its result
export type AnySelectQuery = SelectQuery<any, SelectQueryKind>

/** Type of a record of a query result, or of its value for a query made by `get`, `pluck`, or an aggregate method. */
export type ResultOf<Q extends AnyQuery> = Q["types"]["result"]

/** Binds a query to `db`, so that awaiting it executes it there. */
export function bindQuery<S extends SelectQueryState>(
  query: SelectQuery<S>,
  db: AnyDb,
): BoundSelectQuery<S> {
  return new SelectQuery<S, "bound">(query.table, query.node, query.context, db)
}

/** Table of a definition such as `defineExpression`: the table itself or a query over it with schema context `C`, such as `schema.form`. */
export type TableOrQuery<T extends AnyTable, C extends SchemaContext = SchemaContext> =
  | T
  | QueryOf<QueryStateOf<T, C>>

/** Starts a query over a new occurrence of the table. */
export function from<T extends AnyTable>(table: T): SelectQuery<InitialQueryState<T>> {
  return startQuery(table, noContext)
}

/** Starts a query over a new occurrence of the table with the relations of `context`, such as a query of a table of a schema. */
export function startQuery<S extends SelectQueryState>(
  table: S["table"],
  context: QueryContext,
): SelectQuery<S> {
  return new SelectQuery(table, createQueryNode(Object.freeze({ kind: "table", table })), context)
}
