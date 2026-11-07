// Groups of the rows of queries: the keys of `groupBy` and `distinctOn`, and the filter of `having`.

import { combineNodes } from "../ast/boolean"
import type { ExpressionNode } from "../ast/nodes"
import type { AnyExpression } from "../expression/expression"
import { isOperandSource, operandNode } from "../expression/expression"
import type { AnyTable } from "../table/table"

import type { QueryContext } from "./column-refs"
import { createSelectionRefs } from "./column-refs"
import type { WhereFilter } from "./filters"
import { toFilterNode } from "./filters"
import type { QueryNode } from "./node"
import { createColumnNode, createSelectedRefs } from "./order"
import type { ScalarQuery } from "./select"

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
 * Creates the condition of the groups of `node` with `filter`, what `where` takes, combined with `AND` with its earlier condition.
 *
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
  const predicate = toFilterNode(filter, node.from, context)
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
