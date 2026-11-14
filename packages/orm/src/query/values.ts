// Values of the columns of a table that mutations set: the records of an insert and the values of an update.

import type { AssignmentNode, ExpressionNode, TableSourceNode } from "../ast/nodes"
import type { AnyExpression } from "../expression/expression"
import { toValueNode } from "../expression/expression"
import type { NoRelations, SchemaContext } from "../schema/relation"
import type { AnyColumn, columnDefault } from "../table/column"
import type { AnyTable, ColumnValues, Selectable } from "../table/table"
import { requireColumn } from "../table/table"

import type { ColumnRefs, QueryContext, RelationRefs } from "./column-refs"
import { createSelectionRefs, noContext } from "./column-refs"
import type { ScalarQuery } from "./operand"

/**
 * Value of column `K` of table `T` that an insert or an update sets: a value that its type encodes, `null` for a nullable column, an expression of its values, or a query of one such value.
 *
 * A query may be `NULL` without its row, which PostgreSQL rejects for a column that is not nullable.
 */
export type ColumnValue<T extends AnyTable, K extends keyof T["columns"]> =
  | ColumnValues<T>[K]
  | AnyExpression<Selectable<T>[K]>
  | ScalarQuery<Selectable<T>[K] | null>

/** Key of a column of table `T` that an insert may omit, which gets its default: one with a default of the database or of kern-orm, as `hasDefault` and `default` give it, or a nullable one, whose default is `NULL` unless the database declares another. */
type OptionalColumnKey<T extends AnyTable> = {
  [K in keyof T["columns"]]: T["columns"][K][typeof columnDefault] extends true
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

// A mapped type of its own: a parameter of `InsertValues` for the columns of the key costs each insert more instantiations, and `Omit` of `InsertValues` costs each upsert a fifth more.
/** Values of `upsert` into table `T`: a record of an insert without the columns `K` of the key, whose values `find` or `findBy` gives. */
export type UpsertValues<T extends AnyTable, K extends string> = {
  readonly [C in keyof T["columns"] as C extends OptionalColumnKey<T> | K ? never : C]: ColumnValue<
    T,
    C
  >
} & {
  readonly [C in Exclude<OptionalColumnKey<T>, K>]?: ColumnValue<T, C> | undefined
}

/** Values of the columns of table `T` that an update sets; a column omitted or given as `undefined` keeps its value. */
export type UpdateValues<T extends AnyTable> = {
  readonly [K in keyof T["columns"]]?: ColumnValue<T, K> | undefined
}

/** Argument of `update` of table `T` with schema context `C`: the values that it sets, or a callback that receives the columns and the queries of the relations of the changed rows and returns them. */
export type UpdateSet<T extends AnyTable, C extends SchemaContext = NoRelations> =
  | UpdateValues<T>
  | ((columns: ColumnRefs<T> & RelationRefs<C>) => UpdateValues<T>)

/** Argument of `update` of a conflict of an insert into table `T` with schema context `C`: the values that it sets on the existing record, or a callback that receives the columns and the queries of the relations of the existing record and the columns of the row proposed for insertion, and returns them. */
export type ConflictUpdateSet<T extends AnyTable, C extends SchemaContext = NoRelations> =
  | UpdateValues<T>
  | ((columns: ColumnRefs<T> & RelationRefs<C>, excluded: ColumnRefs<T>) => UpdateValues<T>)

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
 * It rejects a key that is not a column of `table`, and a query other than of one value.
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

/** Column of a table with a default of kern-orm, under its key. */
interface DefaultedColumn {
  readonly key: string
  readonly column: AnyColumn
}

/** Columns of each table with a default of kern-orm, which an insert reads each time it runs. */
const defaultedColumns = new WeakMap<AnyTable, readonly DefaultedColumn[]>()

/** Returns the columns of `table` with a default of kern-orm, in the order of its columns. */
function findDefaultedColumns(table: AnyTable): readonly DefaultedColumn[] {
  let found = defaultedColumns.get(table)
  if (found === undefined) {
    const columns: DefaultedColumn[] = []
    for (const key of Object.keys(table.columns)) {
      const column = table.columns[key]!
      if (column.attributes.default !== undefined) {
        columns.push({ key, column })
      }
    }
    found = columns
    defaultedColumns.set(table, found)
  }
  return found
}

/**
 * Adds the defaults of kern-orm of the columns of `table` to `rows` of an insert into it.
 *
 * A record that omits such a column gets its default instead of `DEFAULT`.
 * A column that no record gives is added after the others.
 * A default that is a function is called for each such record, record by record and column by column, so that an insert that runs again gets new values, as from a default of the database.
 * Without such defaults, `rows` are returned as they are.
 * A function that returns `undefined`, which types reject, leaves `DEFAULT` of the database.
 */
export function addColumnDefaults(table: AnyTable, rows: InsertRows): InsertRows {
  const defaulted = findDefaultedColumns(table)
  if (defaulted.length === 0) {
    return rows
  }
  const columns = rows.columns.slice()
  const indexes: number[] = []
  for (const { key } of defaulted) {
    const index = columns.indexOf(key)
    indexes.push(index === -1 ? columns.push(key) - 1 : index)
  }
  const values: (ExpressionNode | undefined)[][] = []
  for (const row of rows.values) {
    const filled = row.slice()
    while (filled.length < columns.length) {
      filled.push(undefined)
    }
    for (let index = 0; index < defaulted.length; index++) {
      const position = indexes[index]!
      if (filled[position] === undefined) {
        const { column } = defaulted[index]!
        const value = column.attributes.default
        const resolved: unknown = typeof value === "function" ? value() : value
        if (resolved !== undefined) {
          filled[position] = toValueNode(resolved, column.type)
        }
      }
    }
    values.push(filled)
  }
  return { columns, values }
}

/**
 * Returns the assignments of an update of the rows of `source` that `set` gives: the values of its columns, or a callback that receives the references of `source` with the relations of `context`, and those of `excluded` for `DO UPDATE` of a conflict, and returns them, read when it is called.
 *
 * A value of `undefined` keeps its column, so the assignments may be none.
 * It rejects a key that is not a column of the table of `source`, and a query other than of one value.
 */
export function toAssignments(
  source: TableSourceNode,
  set: unknown,
  context: QueryContext,
  excluded?: TableSourceNode,
): AssignmentNode[] {
  const { table } = source
  const values: unknown =
    typeof set !== "function"
      ? set
      : excluded === undefined
        ? set(createSelectionRefs(source, context))
        : set(createSelectionRefs(source, context), createSelectionRefs(excluded, noContext))
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
  return assignments
}

// The column types the parameter, so it needs no cast, as a compared value does.
/** Returns the node of `value` of the column of `table` under `key`: an expression or a query of one value, which lowering replaces with a scalar subquery, or a parameter encoded with the type of the column. */
function resolveValue(table: AnyTable, key: string, value: unknown): ExpressionNode {
  return toValueNode(value, requireColumn(table, key).type)
}
