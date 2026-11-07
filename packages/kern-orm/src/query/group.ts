// Groups of the rows of queries: the arguments of `groupBy`, and the filter of `having`.

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

/** Key of a group returned by the callback of `groupBy`: an expression or a query of one value, such as of a value of a related record. */
export type GroupTerm = AnyExpression | ScalarQuery

/** Keys of a group returned by the callback of `groupBy`: one or an array of them. */
export type GroupTerms = GroupTerm | readonly GroupTerm[]

/**
 * Creates the keys of `node` with the keys of the arguments of `groupBy` after its own.
 *
 * `args` are column keys, or a callback that receives the columns with the relations of `context` and the selected fields, and returns one key or an array of them.
 * A string names a column, never a selected field, whose key names only the field of a record.
 * It rejects a call without keys, which would leave the rows of a query ungrouped when a list built in code is empty.
 */
export function addGroupKeys(
  node: QueryNode,
  context: QueryContext,
  args: readonly unknown[],
): ExpressionNode[] {
  const keys = node.groupBy.slice()
  const first = args[0]
  if (typeof first === "function") {
    const terms: unknown = (first as (columns: unknown, selected: unknown) => unknown)(
      createSelectionRefs(node.from, context),
      createSelectedRefs(node, "grouped"),
    )
    if (Array.isArray(terms)) {
      for (const term of terms) {
        keys.push(readTerm(term))
      }
    } else {
      keys.push(readTerm(terms))
    }
  } else {
    for (const arg of args) {
      if (typeof arg !== "string") {
        throw new TypeError("groupBy takes column keys or a callback")
      }
      keys.push(createColumnNode(node.from, arg))
    }
  }
  if (keys.length === node.groupBy.length) {
    throw new TypeError("groupBy requires at least one key")
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
 * Creates the node of a key returned by the callback of `groupBy`.
 *
 * A query is converted by the method of `operandNode`, which rejects a query other than of one value.
 */
function readTerm(term: unknown): ExpressionNode {
  if (isOperandSource(term)) {
    return term[operandNode]()
  }
  throw new TypeError("The callback of groupBy must return expressions or queries of one value")
}
