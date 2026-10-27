// Values of `find` and `findBy`: the values of the columns of a key of a table, which they filter a query by.

import type { AnyTable, IsKey, KeyColumns, KeyOf, TableKeys } from "../table/table"
import { isKey } from "../table/table"
import type { IsAny } from "../utils/type-helpers"

import type { EqValue } from "./filters"

/**
 * Values of the primary key of table `T` that `find` takes, in the order of its columns, or `never` where the type of `T` tells no primary key.
 *
 * A union of tables gives the union of their values.
 */
export type PrimaryKeyValues<T extends AnyTable> = T extends AnyTable
  ? T["keys"] extends TableKeys<infer PrimaryKey extends KeyColumns, infer _UniqueKey>
    ? {
        readonly [I in keyof PrimaryKey]: NonNullable<
          EqValue<T, PrimaryKey[I] & keyof T["columns"]>
        >
      }
    : never
  : never

/**
 * Check of columns `Columns` of the object of `findBy` that rejects them unless they are exactly a key of table `T`, primary or unique, as the type of `T` tells.
 *
 * A table of `any`, such as of `AnySelectQuery`, takes any columns, as `where` takes any values there.
 */
export type KeyCheck<T extends AnyTable, Columns> = [IsKey<T, Columns>] extends [true]
  ? unknown
  : IsAny<T> extends true
    ? unknown
    : NotAKey<KeyOf<T["keys"]>>

/** Type that the object of `findBy` is checked against when its columns are not exactly a key of the table, naming the keys of the table. */
export interface NotAKey<Keys> {
  readonly "columns must be exactly one key of the table": Keys
}

/**
 * Returns the object of column values that `find` filters a query of `table` by: `values` of the columns of its primary key, in their order.
 *
 * It rejects a table without a primary key, a number of values other than the number of its columns, and `null` and `undefined`.
 */
export function toPrimaryKeyValues(
  table: AnyTable,
  values: readonly unknown[],
): Record<string, unknown> {
  const { primaryKey } = table.keys
  if (primaryKey === undefined) {
    throw new Error(
      `find takes the values of a primary key, which table "${table.name}" does not have; use findBy with a unique key`,
    )
  }
  if (values.length !== primaryKey.length) {
    throw new Error(
      `find takes one value for each column of the primary key of table "${table.name}", ${quoteColumns(primaryKey)}, not ${values.length}`,
    )
  }
  const filter: Record<string, unknown> = {}
  for (let index = 0; index < primaryKey.length; index++) {
    const column = primaryKey[index]!
    filter[column] = requireKeyValue(table, column, values[index], "find")
  }
  return filter
}

/**
 * Returns the object of column values that `findBy` filters a query of `table` by: a copy of `values`, read once.
 *
 * It rejects columns that are not exactly a key of `table`, primary or unique, as `isKey` tells, and `null` and `undefined`.
 */
export function toKeyValues(table: AnyTable, values: unknown): Record<string, unknown> {
  if (typeof values !== "object" || values === null) {
    throw new TypeError(`findBy takes an object of the columns of a key of table "${table.name}"`)
  }
  const columns = Object.keys(values)
  if (!isKey(table, columns)) {
    const listed =
      columns.length === 0 ? "an object without columns" : `columns ${quoteColumns(columns)}`
    throw new Error(
      `findBy takes the columns of one key of table "${table.name}", primary or unique, not ${listed}`,
    )
  }
  // A copy, so that `where` never takes the object for an expression and reads each value once.
  const filter: Record<string, unknown> = {}
  for (const column of columns) {
    const value = (values as Record<string, unknown>)[column]
    filter[column] = requireKeyValue(table, column, value, "findBy")
  }
  return filter
}

// `IS NULL` matches every record whose column of a unique key is `NULL`, and `undefined` is no value.
/** Returns `value` of column `column` of a key of `table` that `method` takes, rejecting `null` and `undefined`. */
function requireKeyValue(table: AnyTable, column: string, value: unknown, method: string): unknown {
  if (value === null || value === undefined) {
    throw new TypeError(
      `${method} got ${value} for column "${column}" of table "${table.name}"; a value of a key is never null or undefined`,
    )
  }
  return value
}

/** Lists `columns` in quotes, separated by commas. */
function quoteColumns(columns: readonly string[]): string {
  return columns.map(column => `"${column}"`).join(", ")
}
