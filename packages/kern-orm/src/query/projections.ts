import type { ProjectionNode, TableSourceNode } from "../ast/nodes"
import { createNode } from "../ast/nodes"
import type { AnyExpression } from "../expression/expression"
import { getType, isExpression, toNode } from "../expression/expression"
import { isRecordKey } from "../result/result"
import { requireColumn } from "../table/table"
import type { AnyType } from "../type/type"

import type { QueryContext } from "./column-refs"
import { createColumnRefs, createSelectionRefs } from "./column-refs"
import type { SelectedNode } from "./node"
import { SelectQuery } from "./select"

/**
 * Creates the fields of `select` over `source`, appending new keys and replacing existing ones in place.
 *
 * `args` are the arguments of `select`: `"*"`, column keys, or a callback that receives the references of `source` with the relations of `context` and returns a selection.
 */
export function mergeProjections(
  projections: readonly SelectedNode[],
  source: TableSourceNode,
  args: readonly unknown[],
  context: QueryContext,
): SelectedNode[] {
  const result = projections.slice()
  const first = args[0]
  if (typeof first === "function") {
    const selection = (first as (columns: unknown) => Record<PropertyKey, unknown>)(
      createSelectionRefs(source, context),
    )
    // `Object.keys` would skip a symbol key, leaving a field that the result type promises.
    for (const key of Reflect.ownKeys(selection)) {
      if (typeof key === "symbol") {
        throw new TypeError("A selected field must have a string key")
      }
      setProjection(result, selectValue(key, selection[key]))
    }
  } else {
    const keys = first === "*" ? Object.keys(source.table.columns) : (args as string[])
    for (const key of keys) {
      setProjection(result, projectColumn(source, key))
    }
  }
  return result
}

/**
 * Creates the projection of the value of `get` or `pluck` over `source`.
 *
 * `arg` is the argument of `method`: a column key, or a callback that receives the columns and returns an expression.
 */
export function projectValue(
  source: TableSourceNode,
  arg: unknown,
  method: "get" | "pluck",
): ProjectionNode {
  if (typeof arg !== "function") {
    return projectColumn(source, arg as string)
  }
  const value: unknown = (arg as (columns: unknown) => unknown)(createColumnRefs(source))
  if (!isExpression(value)) {
    throw new TypeError(`The callback of ${method} must return an expression`)
  }
  const type = getType(value)
  if (!type) {
    throw new TypeError(
      `The expression of ${method} has no type to decode its values; build a sql fragment with a type, such as sql(t.integer)`,
    )
  }
  // The key names no record field: it only names the projection in SQL and in decoding errors.
  return projectExpression("value", value, type)
}

/** Creates the field of a value of a selection under `key`: an expression with a type, or a query whose rows become its value. */
function selectValue(key: string, value: unknown): SelectedNode {
  if (value instanceof SelectQuery) {
    return Object.freeze({ key, query: value.node, db: value.db })
  }
  if (!isExpression(value)) {
    throw new TypeError(`Selected field "${key}" must be an expression or a query`)
  }
  const type = getType(value)
  if (!type) {
    throw new TypeError(
      `Selected field "${key}" has no type to decode its values; build a sql fragment with a type, such as sql(t.integer)`,
    )
  }
  return projectExpression(key, value, type)
}

/** Creates the projection of a column of the table of `source` under its key. */
function projectColumn(source: TableSourceNode, key: string): ProjectionNode {
  const { type } = requireColumn(source.table, key)
  return Object.freeze({ key, expression: createNode({ kind: "column", source, key }), type })
}

/** Creates the projection of an expression under `key`, decoded with `type`, the type of the expression. */
function projectExpression(key: string, value: AnyExpression, type: AnyType): ProjectionNode {
  return Object.freeze({ key, expression: toNode(value), type })
}

/** Adds or replaces a field by key, rejecting a key that a record cannot have. */
function setProjection(projections: SelectedNode[], projection: SelectedNode): void {
  const { key } = projection
  if (!isRecordKey(key)) {
    throw new Error(`Field "${key}" cannot be selected: it is not a valid record key`)
  }
  for (let index = 0; index < projections.length; index++) {
    if (projections[index]!.key === key) {
      // Replacing the whole projection keeps the expression and its decoder together at the field's position.
      projections[index] = projection
      return
    }
  }
  projections.push(projection)
}
