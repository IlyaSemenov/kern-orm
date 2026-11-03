// Values of the columns of a table that mutations set: the records of an insert and the values of an update.

import type { AssignmentNode, ExpressionNode, TableSourceNode } from "../ast/nodes"
import type { AnyExpression } from "../expression/expression"
import { toValueNode } from "../expression/expression"
import type { AnyTable, ColumnValues, Selectable } from "../table/table"
import { requireColumn } from "../table/table"

import type { ColumnRefs } from "./column-refs"
import { createColumnRefs } from "./column-refs"
import { MutationQuery } from "./mutation"
import { RecordQuery } from "./record"
import { SelectQuery } from "./select"
import { SqlQuery } from "./sql-query"

/** Value of column `K` of table `T` that an insert or an update sets: a value that its type encodes, `null` for a nullable column, or an expression of its values. */
export type ColumnValue<T extends AnyTable, K extends keyof T["columns"]> =
  | ColumnValues<T>[K]
  | AnyExpression<Selectable<T>[K]>

/** Key of a column of table `T` that an insert may omit, which gets its default: one that the database gives a value, as `hasDefault` marks it, or a nullable one, whose default is `NULL` unless the database declares another. */
type OptionalColumnKey<T extends AnyTable> = {
  [K in keyof T["columns"]]: T["columns"][K]["attributes"]["hasDefault"] extends true
    ? K
    : null extends ColumnValues<T>[K]
      ? K
      : never
}[keyof T["columns"]]

/** Record of an insert into table `T`: the values of its columns, which may omit a column with a default or a nullable column, or give it as `undefined`. */
export type InsertValues<T extends AnyTable> = {
  readonly [K in keyof T["columns"] as K extends OptionalColumnKey<T> ? never : K]: ColumnValue<
    T,
    K
  >
} & {
  readonly [K in OptionalColumnKey<T>]?: ColumnValue<T, K> | undefined
}

/** Values of the columns of table `T` that an update sets; a column omitted or given as `undefined` keeps its value. */
export type UpdateValues<T extends AnyTable> = {
  readonly [K in keyof T["columns"]]?: ColumnValue<T, K> | undefined
}

/** Argument of `update`: the values that it sets, or a callback that receives the columns of the changed rows and returns them. */
export type UpdateSet<T extends AnyTable> =
  | UpdateValues<T>
  | ((columns: ColumnRefs<T>) => UpdateValues<T>)

/** Columns and rows of `VALUES` of an insert. */
export interface InsertRows {
  readonly columns: readonly string[]
  readonly values: readonly (readonly (ExpressionNode | undefined)[])[]
}

/**
 * Returns the columns and the rows of `VALUES` of an insert of `records`, at least one, into `table`, reading the keys and values of each record when it is called.
 *
 * The columns are those that some record gives a value other than `undefined`, in the order that the records first give them, and a record that omits one inserts its `DEFAULT`.
 * Several records without values insert the `DEFAULT` of the first column of the table, since `DEFAULT VALUES` inserts one row.
 * It rejects a key that is not a column of `table`, and a query as a value.
 */
export function toInsertRows(
  table: AnyTable,
  records: readonly unknown[],
  method: string,
): InsertRows {
  if (records.length === 0) {
    throw new Error(`${method} takes at least one record`)
  }
  const columns: string[] = []
  const rows: (ExpressionNode | undefined)[][] = []
  for (const record of records) {
    if (typeof record !== "object" || record === null) {
      throw new TypeError(
        `${method} takes records of the values of the columns of table "${table.name}"`,
      )
    }
    // Each value is resolved once, in the order of the keys of its record, and placed by its column afterwards.
    const row: (ExpressionNode | undefined)[] = []
    for (const key of Object.keys(record)) {
      const value = (record as Record<string, unknown>)[key]
      if (value === undefined) {
        continue
      }
      let index = columns.indexOf(key)
      if (index === -1) {
        index = columns.push(key) - 1
      }
      row[index] = resolveValue(table, key, value)
    }
    rows.push(row)
  }
  if (columns.length === 0 && rows.length > 1) {
    const first = Object.keys(table.columns)[0]
    if (first !== undefined) {
      columns.push(first)
    }
  }
  // A record that lacks a column, as a hole or past the end of its row, inserts its `DEFAULT`.
  for (const row of rows) {
    while (row.length < columns.length) {
      row.push(undefined)
    }
  }
  return { columns, values: rows }
}

/**
 * Returns the assignments of an update of the rows of `source` that `set` gives: the values of its columns, or a callback that receives the columns and returns them, read when it is called.
 *
 * A value of `undefined` keeps its column, and an update must set at least one column.
 * It rejects a key that is not a column of the table of `source`, and a query as a value.
 */
export function toAssignments(source: TableSourceNode, set: unknown): AssignmentNode[] {
  const { table } = source
  const values: unknown = typeof set === "function" ? set(createColumnRefs(source)) : set
  if (typeof values !== "object" || values === null) {
    throw new TypeError(
      `update takes the values of the columns of table "${table.name}" or a callback that returns them`,
    )
  }
  const assignments: AssignmentNode[] = []
  for (const key of Object.keys(values)) {
    const value = (values as Record<string, unknown>)[key]
    if (value !== undefined) {
      assignments.push(Object.freeze({ key, value: resolveValue(table, key, value) }))
    }
  }
  if (assignments.length === 0) {
    throw new Error(
      `update takes the value of at least one column of table "${table.name}"; a column given as undefined keeps its value`,
    )
  }
  return assignments
}

// The column types the parameter, so it needs no cast, as a compared value does.
/** Returns the node of `value` of the column of `table` under `key`: an expression, or a parameter encoded with the type of the column. */
function resolveValue(table: AnyTable, key: string, value: unknown): ExpressionNode {
  const column = requireColumn(table, key)
  // Checked before `toValueNode`, which would take a query of one value as a subquery: types reject a query only where the column does not take any value, unlike `jsonb`.
  if (
    value instanceof SelectQuery ||
    value instanceof RecordQuery ||
    value instanceof MutationQuery ||
    value instanceof SqlQuery
  ) {
    throw new TypeError(
      `Column "${key}" of table "${table.name}" takes a value or an expression, not a query`,
    )
  }
  return toValueNode(value, column.type)
}
