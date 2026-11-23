// Columns of a table in SQL text: the columns of the rows of a table or view for a statement of SQL text, such as of `$query`, which selects them in its text and reads their records from its result.

import type { GuaranteedColumnKeys, PickSelectedColumns, SqlColumns } from "kern-db"
import type { SqlColumn } from "kern-db/builder"
import { createSqlColumns } from "kern-db/builder"

import type { AnyRowSource, KeyColumns, TableKeys } from "../table/table"
import { findColumn } from "../table/table"
import type { TypeOutput } from "../type/type"
import type { Simplify } from "../utils/type-helpers"

import type { SelectQueryKind } from "./kind"
import { isTableQuery } from "./node"
import { SelectQuery } from "./select"
import type { QueryStateOf } from "./state"

/** Options of `columnsOf` of the columns of keys `C`, in their order. */
export interface ColumnsOfOptions<C extends readonly string[] = readonly string[]> {
  /** Alias of the table in the statement, such as `j` of `FROM job j`, which qualifies the columns; without it, the columns are not qualified. */
  readonly alias?: string
  /**
   * Prefix of the names of the result columns, such as `job` for `job__id`; the result columns of several tables of one statement must have different names.
   *
   * It is the alias by default; without both, a result column has the key of its column as its name.
   */
  readonly prefix?: string
  /**
   * Keys of the columns to select, in their order; all the columns of the table without it.
   *
   * The record requires a column only when the list guarantees its key, as `select` of a query by keys does: the column of a key that is a union of keys, a key of a spread array, or a key typed as `string` is optional, and a key of one known column written before or after a spread is guaranteed.
   */
  readonly columns?: C
}

/** Record of the columns of keys `K` of table `T`, with the values that their types return. */
export type ColumnsRecord<T extends AnyRowSource, K extends keyof T["columns"]> = {
  [P in K]: TypeOutput<T["columns"][P]["type"]>
}

/** Tells whether columns `K`, a union of column keys, include the primary key of table `T`; `boolean` when the type of `T` does not tell its keys. */
export type IncludesPrimaryKey<T extends AnyRowSource, K> =
  T["keys"] extends TableKeys<infer PrimaryKey, infer _UniqueKey>
    ? PrimaryKey extends KeyColumns
      ? [PrimaryKey[number]] extends [K]
        ? true
        : false
      : false
    : boolean

/**
 * Returns the columns of the rows of a table or view for a statement of SQL text, such as of `$query`: interpolate them into its text, such as after `SELECT` or `RETURNING`, and pass them to `select` of the query as a field, which is the record of the row, with the keys and the types of the columns of the table.
 *
 * `source` is a table of a `Db`, such as `db.form`, or the definition of a table or view.
 * The statement must name the table by `alias` when it gives the table one, and the result columns of several tables whose columns it selects must have different names, such as by an alias of each.
 */
export function columnsOf<
  T extends AnyRowSource,
  // `never` without the option stands for every column of the table, which differs from a list of keys typed as `string` in that it includes the primary key.
  const C extends readonly (keyof T["columns"] & string)[] = never,
>(
  source: T | SelectQuery<QueryStateOf<T>, SelectQueryKind>,
  options?: ColumnsOfOptions<C>,
  // `NoInfer`, so that a call in a field of `select` does not infer `C` from the type of the field, which would compute the record of every column of the table as a list, at nearly three times the instantiations of such a query; decisions/sql-queries/columns-of-return-type.md measures it and the alternatives.
): NoInfer<
  SqlColumns<
    [C] extends [never]
      ? ColumnsRecord<T, keyof T["columns"] & string>
      : Simplify<PickSelectedColumns<ColumnsRecord<T, keyof T["columns"] & string>, C>>,
    IncludesPrimaryKey<T, [C] extends [never] ? keyof T["columns"] : GuaranteedColumnKeys<C>>
  >
>
export function columnsOf(source: unknown, options: ColumnsOfOptions = {}): unknown {
  const table = toRowSource(source)
  const keys: unknown = options.columns ?? Object.keys(table.columns)
  if (!Array.isArray(keys)) {
    throw new TypeError("The columns option of columnsOf must be an array of column keys")
  }
  const columns: SqlColumn[] = []
  for (const key of keys as unknown[]) {
    const column = typeof key === "string" ? findColumn(table, key) : undefined
    if (column === undefined) {
      throw new Error(`${table.kind} "${table.name}" has no column "${String(key)}"`)
    }
    columns.push({
      key: key as string,
      name: column.attributes.name ?? (key as string),
      type: column.type,
    })
  }
  const { primaryKey } = table.keys
  return createSqlColumns(columns, {
    alias: options.alias,
    prefix: options.prefix,
    // Columns without the whole primary key have no key that tells a missing row.
    key: primaryKey?.every(key => keys.includes(key)) ? primaryKey : undefined,
  })
}

/** Returns the table or view of `source` of `columnsOf`: of a query of a table without clauses, or the definition itself. */
function toRowSource(source: unknown): AnyRowSource {
  if (source instanceof SelectQuery) {
    // The columns of a query differ from those of its table once it selects fields, and the statement does not have its rows.
    if (!isTableQuery(source.node)) {
      throw new TypeError(
        "columnsOf takes a table, such as db.form, not a query of its records; pass the table and keep the conditions of the query in the statement",
      )
    }
    return source.table
  }
  // A definition has no class or brand, so it is told by its members.
  if (
    typeof source === "object" &&
    source !== null &&
    "columns" in source &&
    "keys" in source &&
    "name" in source
  ) {
    return source as AnyRowSource
  }
  throw new TypeError("columnsOf takes a table or view, such as db.form or its definition")
}
