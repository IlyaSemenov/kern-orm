import type { ScalarProjection, TableSourceNode } from "../ast/nodes"
import { createList, createNode } from "../ast/nodes"
import type { AnyExpression } from "../expression/expression"
import { getType, isExpression, toFunctionOperandNode, toNode } from "../expression/expression"
import { isRecordKey } from "../result/result"
import { requireColumn } from "../table/table"
import type { AnyType } from "../type/type"

import { addFallback, isAggregateProjection } from "./aggregate"
import type { QueryContext } from "./column-refs"
import { createSelectionRefs } from "./column-refs"
import { TransformedQuery } from "./conversion"
import { isExistsProjection } from "./exists"
import { Literal } from "./literal"
import { MutationQuery } from "./mutation"
import type { SelectedNode } from "./node"
import { RecordQuery } from "./record"
import { SelectQuery } from "./select"
import { SqlQuery } from "./sql-query"

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
    addSelection(
      result,
      (first as (columns: unknown) => Record<PropertyKey, unknown>)(
        createSelectionRefs(source, context),
      ),
    )
  } else {
    const keys = first === "*" ? Object.keys(source.table.columns) : (args as string[])
    for (const key of keys) {
      setProjection(result, projectColumn(source, key))
    }
  }
  return result
}

/** Adds the fields of `selection`, expressions, queries, and literals by key, to `projections`, replacing existing keys in place. */
export function addSelection(
  projections: SelectedNode[],
  selection: Readonly<Record<PropertyKey, unknown>>,
): void {
  // `Object.keys` would skip a symbol key, leaving a field that the result type promises.
  for (const key of Reflect.ownKeys(selection)) {
    if (typeof key === "symbol") {
      throw new TypeError("A selected field must have a string key")
    }
    setProjection(projections, selectValue(key, selection[key]))
  }
}

/**
 * Creates the projection of the value of `get` or `pluck`, or of the argument of an aggregate method, such as `max`, over `source`.
 *
 * `arg` is the argument of `method`: a column key, or a callback that receives the references of `source` with the relations of `context` and returns an expression or a query of one value.
 * The value of such a query is that of `expr`, `NULL` without its row, since the projection holds one scalar rather than nested rows.
 */
export function projectValue(
  source: TableSourceNode,
  arg: unknown,
  method: string,
  context: QueryContext,
): ScalarProjection {
  if (typeof arg !== "function") {
    return projectColumn(source, arg as string)
  }
  const result: unknown = (arg as (columns: unknown) => unknown)(
    createSelectionRefs(source, context),
  )
  // `expr` rejects a query other than of one value.
  const value = result instanceof SelectQuery ? result.expr() : result
  if (!isExpression(value)) {
    throw new TypeError(
      `The callback of ${method} must return an expression or a query of one value`,
    )
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

// The fallback is encoded by the type of the value without a cast, so PostgreSQL types it by the value, such as `bigint` for the sum of `integer` values.
/**
 * Creates the projection of the value of `field`, the only projection of a query of values, whose `NULL` `fallback` replaces: a value that the type of the field encodes, an expression, or a query of one value.
 *
 * The projection of an aggregate keeps its call, which lowering builds, and adds the fallback after its earlier ones.
 * The projection of `exists` stays as it is, since `EXISTS` is never `NULL`.
 */
export function coalesceValue(field: ScalarProjection, fallback: unknown): ScalarProjection {
  const value = toFunctionOperandNode(fallback, field.type, "coalesce")
  if (isExistsProjection(field)) {
    return field
  }
  if (isAggregateProjection(field)) {
    return addFallback(field, value)
  }
  return Object.freeze({
    key: field.key,
    expression: createList("coalesce(", [field.expression, value], ")"),
    type: field.type,
  })
}

/** Creates the field of a value of a selection under `key`: an expression with a type, a query whose rows become its value, or a literal. */
function selectValue(key: string, value: unknown): SelectedNode {
  if (value instanceof Literal) {
    return Object.freeze({ key, literal: value.literal })
  }
  if (value instanceof SelectQuery || value instanceof TransformedQuery) {
    return Object.freeze({ key, query: value.node, db: value.db })
  }
  if (value instanceof RecordQuery) {
    throw new TypeError(
      `Selected field "${key}" is a query of $select, which cannot be nested; select its fields directly instead`,
    )
  }
  if (value instanceof MutationQuery) {
    throw new TypeError(
      `Selected field "${key}" is a query of insert, update, or delete, which cannot be nested`,
    )
  }
  if (value instanceof SqlQuery) {
    throw new TypeError(`Selected field "${key}" is a query of $query, which cannot be nested`)
  }
  if (!isExpression(value)) {
    throw new TypeError(`Selected field "${key}" must be an expression, a query, or a literal`)
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
function projectColumn(source: TableSourceNode, key: string): ScalarProjection {
  const { type } = requireColumn(source.table, key)
  return Object.freeze({ key, expression: createNode({ kind: "column", source, key }), type })
}

/** Creates the projection of an expression under `key`, decoded with `type`, the type of the expression. */
function projectExpression(key: string, value: AnyExpression, type: AnyType): ScalarProjection {
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
