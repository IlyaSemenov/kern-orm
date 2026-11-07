// Groups of the rows of queries: the keys of `groupBy` and `distinctOn`, and the filter of `having`.

import { combineNodes } from "../ast/boolean"
import type { ExpressionNode } from "../ast/nodes"
import type { GroupValue } from "../expression/aggregates"
import type { AnyExpression, Expression } from "../expression/expression"
import { isOperandSource, operandNode } from "../expression/expression"
import type { AnyTable } from "../table/table"

import { isAggregateQuery } from "./aggregate"
import type { ColumnRefs, QueryContext, RelationRefs } from "./column-refs"
import { createSelectionRefs } from "./column-refs"
import { isExistsQuery } from "./exists"
import type { WhereCondition, WhereFilter } from "./filters"
import { toFilterNode } from "./filters"
import type { QueryNode } from "./node"
import type { ScalarQuery } from "./operand"
import { createColumnNode, createSelectedRefs } from "./order"
import type { SelectedFieldTypesOf } from "./selection"
import type { QueryValueType, SelectQueryState } from "./state"

/** Key of a group returned by the callback of `groupBy` or `distinctOn`: an expression or a query of one value, such as of a value of a related record. */
export type GroupTerm = AnyExpression | ScalarQuery

/** Keys of a group returned by the callback of `groupBy` or `distinctOn`: one or an array of them. */
export type GroupTerms = GroupTerm | readonly GroupTerm[]

/** Method that takes the keys of groups, and the phrase of what it does with a field that cannot be a key, for its errors. */
const keyMethods = {
  groupBy: "grouped by",
  distinctOn: "a key of distinctOn",
} as const

/**
 * Creates the keys of `method`, `groupBy` or `distinctOn`, of `node` with the keys of the arguments of the call after its own.
 *
 * `args` are column keys, or a callback that receives the columns with the relations of `context` and the selected fields, and returns one key or an array of them.
 * A string names a column, never a selected field, whose key names only the field of a record.
 * It rejects a call without keys, which would leave the rows of a query ungrouped, or keep all of them, when a list built in code is empty.
 */
export function addGroupKeys(
  method: keyof typeof keyMethods,
  node: QueryNode,
  context: QueryContext,
  args: readonly unknown[],
): ExpressionNode[] {
  const existing = node[method]
  const keys = existing.slice()
  const first = args[0]
  if (typeof first === "function") {
    const terms: unknown = (first as (columns: unknown, selected: unknown) => unknown)(
      createSelectionRefs(node.from, context),
      createSelectedRefs(node, keyMethods[method]),
    )
    if (Array.isArray(terms)) {
      for (const term of terms) {
        keys.push(readTerm(term, method))
      }
    } else {
      keys.push(readTerm(terms, method))
    }
  } else {
    for (const arg of args) {
      if (typeof arg !== "string") {
        throw new TypeError(`${method} takes column keys or a callback`)
      }
      keys.push(createColumnNode(node.from, arg))
    }
  }
  if (keys.length === existing.length) {
    throw new TypeError(`${method} requires at least one key`)
  }
  return keys
}

/**
 * What the callback of `having` of a query of state `S` receives as its second parameter: the references to the selected fields of a query of records, with the operators and the values of the types of their fields, the expression of the value of a query made by `get` or `pluck`, and `undefined` for an aggregate query, a query of `exists`, and a query that `map` converts.
 *
 * A field of nested rows or of a literal is among the references, but reading it throws; a field of the rows of a query of one value, such as of `get`, has the operators of its value in types.
 */
export type HavingFields<S extends SelectQueryState> = S["value"] extends false
  ? {
      readonly [K in keyof S["result"] & string]: FieldRef<
        SelectedFieldTypesOf<S["fieldTypes"]>,
        K,
        S["result"][K]
      >
    }
  : S["value"] extends true
    ? S["aggregate"] extends false
      ? ToFieldRef<S["valueType"], S["result"]>
      : undefined
    : undefined

/** Reference of the callback of `having` to field `K` of values `V`, with the type of its value among field types `F`, for each member of a union of them. */
type FieldRef<F, K extends string, V> = K extends keyof F
  ? ToFieldRef<Exclude<F[K], undefined>, V>
  : AnyExpression<V>

/** Expression of values `V` with the operators and the values of type `D` of a value, or without them when `D` is none. */
type ToFieldRef<D, V> = D extends QueryValueType
  ? D extends { readonly group: infer G }
    ? unknown extends G
      ? Expression<V, D["operators"], D["input"]>
      : // References can escape this callback and be selected without grouping, so retain standalone nullability and the group mark.
        Expression<V | null, D["operators"], D["input"]> & GroupValue<G>
    : Expression<V, D["operators"], D["input"]>
  : AnyExpression<V>

// One callback type rather than overloads: TypeScript gives the parameters of a callback their types from the first overload that it tries, so an overload of a callback of one parameter first would leave both parameters of a callback of two untyped.
// It resolves `HavingFields` also for a callback that declares no second parameter, since TypeScript compares the parameters of both signatures.
/**
 * Argument of `having` of a query of state `S`: a condition of `where`, or a callback that receives the columns and the relations of the table, and the fields of `HavingFields`, and returns one.
 *
 * It reads `S` only in its branch, as `QueryWhereFilter` does.
 */
export type QueryHavingFilter<S extends SelectQueryState> = [S] extends [unknown]
  ?
      | WhereCondition<S["table"]>
      | ((
          // An intersection rather than one alias of both, as for the callback of `select`.
          columns: ColumnRefs<S["table"]> & RelationRefs<S["schema"]>,
          selected: HavingFields<S>,
        ) => WhereCondition<S["table"]>)
  : never

/**
 * Creates the condition of the groups of `node` with `filter`, what `where` takes, combined with `AND` with its earlier condition.
 *
 * A callback also receives the fields selected so far, as `HavingFields` tells, so that a condition reads an aggregate or a key of an expression by its field.
 * The condition stands apart from the filters of the rows, so it requires keys: without them, `having` would read as a filter of rows while PostgreSQL takes the whole query for one group.
 */
export function addHaving(
  node: QueryNode,
  filter: WhereFilter<AnyTable>,
  context: QueryContext,
): ExpressionNode {
  if (node.groupBy.length === 0) {
    throw new Error("having requires an earlier groupBy; filter the rows with where")
  }
  const predicate = toFilterNode(filter, node.from, context, () =>
    node.conversion !== undefined || isAggregateQuery(node) || isExistsQuery(node)
      ? undefined
      : createSelectedRefs(node, "read in having"),
  )
  return node.having === undefined ? predicate : combineNodes("and", [node.having, predicate])
}

/**
 * Creates the node of a key returned by the callback of `method`.
 *
 * A query is converted by the method of `operandNode`, which rejects a query other than of one value.
 */
function readTerm(term: unknown, method: string): ExpressionNode {
  if (isOperandSource(term)) {
    return term[operandNode]()
  }
  throw new TypeError(`The callback of ${method} must return expressions or queries of one value`)
}
