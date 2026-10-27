import type { ResultRows } from "../result/result"
import type { NoRelations, SchemaContext, UsableRelation, UsedRelation } from "../schema/relation"
import type { AnyTable } from "../table/table"

import type { SelectQueryKind } from "./kind"
import type { OneRow } from "./rows"
import type {
  AnySelectQuery,
  ChangeState,
  QueryStateOf,
  SelectQuery,
  SelectQueryState,
  TableOrQuery,
} from "./select"
import { requireDerived } from "./select"
import type { HelperFields, MergeSelection } from "./selection"

/** State of the query that the callback of a helper of table `T` with schema context `C` receives: the fields of the query the helper is applied to, and all its rows. */
interface HelperState<T extends AnyTable, C extends SchemaContext> extends QueryStateOf<T, C> {
  readonly result: HelperFields<never>
  readonly rows: "many"
  readonly value: false
  readonly uses: never
}

/**
 * Effect of a helper: the fields it selects, its rows mode on a query of many rows, `one` after `take` or `required` and `nullable` or `optional` after the method of the same name, and the relations it selects records of.
 *
 * `reads` are the relations of the schema of the helper among them, which its callback may read from the references of the query it is applied to, and `key` is the key of its table there.
 */
export interface HelperEffect {
  readonly fields: object
  readonly rows: ResultRows
  readonly uses: UsedRelation
  readonly reads: UsedRelation
  readonly key: string
}

// The effect holds the selected fields without the marker, so that the declarations of a module exporting a helper never name the marker.
/** Effect of a helper whose callback returns a query of state `S`, for each state of a union. */
type ReadEffect<S extends SelectQueryState> = S extends SelectQueryState
  ? {
      readonly fields: {
        [K in keyof S["result"] as K extends keyof HelperFields ? never : K]: S["result"][K]
      }
      readonly rows: S["rows"]
      readonly uses: S["uses"]
      // Relations of the schema context that the uses match, so that uses widened to any relation require all of them.
      readonly reads: Extract<UsableRelation<S["schema"]["relations"]>, S["uses"]>
      readonly key: S["schema"]["key"]
    }
  : never

/** Error of a helper that a query does not accept, or whose callback returns a query it does not accept. */
interface HelperError<Message extends string> {
  readonly error: Message
}

// Clearing the selection would discard the marker, so the effect could not describe which input fields survive.
// `value` is checked as well, since the value of `get` or `pluck` of an expression of `any` passes for the marker.
/** `unknown` when every result state retains the input marker and returns records, or the error. */
type CheckResult<S extends SelectQueryState> = [S] extends [
  { readonly result: HelperFields; readonly value: false },
]
  ? unknown
  : HelperError<"A helper can filter, select fields, and take one row, but cannot clear the selection or use get or pluck">

/** `unknown` when a query of state `S` accepts a helper of effect `E`, or the error. */
type CheckApply<S extends SelectQueryState, E extends HelperEffect> = [
  CheckReads<S["schema"], E>,
] extends [true]
  ? [S["value"]] extends [false]
    ? unknown
    : // A query of values rejects even one branch that selects fields or ends with a call of `nullable`.
      [E extends HelperEffect ? keyof E["fields"] : never] extends [never]
      ? [Extract<E["rows"], "nullable">] extends [never]
        ? unknown
        : HelperError<"A helper cannot apply nullable to a query made by get or pluck">
      : HelperError<"A helper cannot select fields on a query made by get or pluck">
  : HelperError<"The query has no relation that the helper selects">

// The callback reads the relations of the query it is applied to by name, so the query must be of the table of the helper under the same key and have them.
// Relations of other schemas, such as of an independent query that the helper nests, stay in `uses` for the `Db`.
/** `true` when a query of schema context `C` has the relations of its schema that a helper of effect `E` may read. */
type CheckReads<C extends SchemaContext, E extends HelperEffect> = [E["reads"]] extends [never]
  ? true
  : [C["key"]] extends [E["key"]]
    ? [E["reads"]] extends [UsableRelation<C["relations"]>]
      ? true
      : false
    : false

/** State of a query of state `S` after a helper of effect `E`. */
type ApplyEffect<S extends SelectQueryState, E extends HelperEffect> = ChangeState<
  S,
  {
    result: [keyof E["fields"]] extends [never]
      ? S["result"]
      : MergeSelection<S["result"], E["fields"]>
    // `required` also leaves `one`, which the effect cannot tell from `take`, so a query of one row keeps its mode in types while `required` changes it to `one`.
    rows: E["rows"] extends "many"
      ? S["rows"]
      : E["rows"] extends "one"
        ? OneRow<S["rows"]>
        : E["rows"]
    uses: S["uses"] | E["uses"]
  }
>

/**
 * Helper of `defineHelper` for queries over table `T`: it applies effect `E` to the query it receives with arguments `A` and returns a query of the same kind.
 *
 * Selected fields replace earlier fields under the same keys; a query made by `get` or `pluck` does not accept a helper that selects fields.
 */
export type Helper<T extends AnyTable, E extends HelperEffect, A extends unknown[]> = <
  S extends QueryStateOf<T>,
  Kind extends SelectQueryKind,
>(
  query: SelectQuery<S, Kind> & CheckApply<S, E>,
  ...args: A
) => E extends HelperEffect ? SelectQuery<ApplyEffect<S, E>, Kind> : never

/**
 * Defines a reusable helper of a table that filters, selects fields, and applies `take`, `optional`, `nullable`, and `required`, used with `use` or called with a query.
 *
 * `helper` receives the query it is applied to and any further arguments, and returns the query with its clauses.
 * Defined with a query of a schema, such as `schema.form`, it can select the relations of the table in that schema, and applies to queries whose schema has them.
 * The helper returns a query of the same kind as the one it is applied to, bound to the same `Db` if any.
 */
export function defineHelper<
  T extends AnyTable,
  // oxlint-disable-next-line typescript/no-explicit-any -- a query of any state
  R extends SelectQuery<any, SelectQueryKind>,
  A extends unknown[],
  C extends SchemaContext = NoRelations,
>(
  table: TableOrQuery<T, C>,
  helper: (
    query: SelectQuery<HelperState<T, C>, SelectQueryKind>,
    ...args: A
  ) => R & CheckResult<R["types"]>,
): Helper<T, ReadEffect<R["types"]>, A>
export function defineHelper(
  _table: unknown,
  helper: (query: AnySelectQuery, ...args: unknown[]) => AnySelectQuery,
): unknown {
  return (query: AnySelectQuery, ...args: unknown[]) =>
    requireDerived(query, helper(query, ...args), "The callback of a helper")
}
