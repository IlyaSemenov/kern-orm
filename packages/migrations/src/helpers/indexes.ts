import type { MigrationStep } from "../migration"
import { quoteIdentifier } from "../sql"

import { invertStep } from "./step"

/** Options of `createIndex` and `dropIndex`. */
export interface IndexOptions {
  /**
   * Name of the index.
   *
   * Without it, the name is the one that PostgreSQL gives an index without a name, `<table>_<columns>_idx` of the columns and the `include` columns, such as `form_field_form_id_idx`.
   * The name is required when an element is not a lowercase column name, with an optional ordering such as `DESC`, when a column repeats, or when the name would be longer than 63 bytes.
   */
  name?: string
  unique?: boolean
  /** Treats `NULL` values as equal when a unique index compares keys. */
  nullsNotDistinct?: boolean
  /** Index method, such as `"gin"`. */
  using?: string
  /** Columns that the index stores without searching by them, each a SQL reference to a column, such as `"label"`. */
  include?: readonly string[]
  /** SQL condition of a partial index, such as `"deleted_at IS NULL"`. */
  where?: string
}

/**
 * Builds a step that creates an index of a table, and drops it on rollback.
 *
 * `columns` are the SQL elements of the index: columns or expressions, with their ordering, such as `["form_id", "position DESC"]`, `["lower(email)"]`, or `["(true)"]`.
 */
export function createIndex(
  table: string,
  columns: readonly string[],
  options: IndexOptions = {},
): MigrationStep {
  if (columns.length === 0) {
    throw new Error(`Cannot create an index of table ${table} without columns`)
  }
  const include = options.include ?? []
  const name = quoteIdentifier(options.name ?? getIndexName(table, columns, include))
  let up = `CREATE ${options.unique ? "UNIQUE " : ""}INDEX ${name} ON ${quoteIdentifier(table)}`
  if (options.using !== undefined) {
    up += ` USING ${options.using}`
  }
  up += ` (${columns.join(", ")})`
  if (include.length > 0) {
    up += ` INCLUDE (${include.join(", ")})`
  }
  if (options.nullsNotDistinct) {
    up += " NULLS NOT DISTINCT"
  }
  if (options.where !== undefined) {
    up += ` WHERE ${options.where}`
  }
  return { up, down: `DROP INDEX ${name}` }
}

/**
 * Builds a step that drops an index of a table, and creates it again on rollback as `createIndex` of the same arguments does.
 *
 * It drops the index of the name that `createIndex` gives it.
 */
export function dropIndex(
  table: string,
  columns: readonly string[],
  options: IndexOptions = {},
): MigrationStep {
  return invertStep(createIndex(table, columns, options))
}

// A column whose name needs no quotes, which PostgreSQL names an index by.
const plainColumn = /^[a-z_][a-z0-9_$]*$/

// A column of an index with an optional ordering, which PostgreSQL leaves out of the name of the index.
// It separates words by the whitespace of SQL only, since PostgreSQL reads another space, such as U+00A0, as a character of a name; and matches the keywords in ASCII case only, since the `i` flag without `u` keeps non-ASCII letters, such as `ſ`, from matching ASCII ones.
const orderedColumn =
  /^[ \t\n\r\f\v]*([A-Za-z_][\w$]*)(?:[ \t\n\r\f\v]+(?:ASC|DESC))?(?:[ \t\n\r\f\v]+NULLS[ \t\n\r\f\v]+(?:FIRST|LAST))?[ \t\n\r\f\v]*$/i

// The default `max_identifier_length` of PostgreSQL, which truncates longer names.
const maxNameBytes = 63

/**
 * Returns the name that PostgreSQL gives an index of `columns` and `include` without a name, `<table>_<columns>_idx`.
 *
 * It throws when PostgreSQL would name the index otherwise: for an element that is not a plain column, with an ordering in `columns`, such as an expression; for a repeated column, which PostgreSQL numbers; and for a name that PostgreSQL would truncate.
 */
function getIndexName(
  table: string,
  columns: readonly string[],
  include: readonly string[],
): string {
  const describe = (problem: string) =>
    new Error(
      `Cannot name the index of table ${table} on ${[...columns, ...include].join(", ")}: ${problem}`,
    )
  const names: string[] = []
  for (const element of columns) {
    const name = getColumnName(element)
    if (name === undefined) {
      throw describe(
        `${element} is not a lowercase column name with an optional ordering, so pass name`,
      )
    }
    names.push(name)
  }
  for (const element of include) {
    if (!plainColumn.test(element)) {
      throw describe(`${element} is not a lowercase column name, so pass name`)
    }
    names.push(element)
  }
  const repeated = names.find((name, index) => names.indexOf(name) !== index)
  if (repeated !== undefined) {
    throw describe(`column ${repeated} repeats, so pass name`)
  }
  const name = `${table}_${names.join("_")}_idx`
  if (new TextEncoder().encode(name).length > maxNameBytes) {
    throw describe(`${name} is longer than ${maxNameBytes} bytes, so pass a shorter name`)
  }
  return name
}

/** Returns the column of an element of an index that is a plain column with an optional ordering, such as `position DESC`, or `undefined` for another element. */
function getColumnName(element: string): string | undefined {
  const column = orderedColumn.exec(element)?.[1]
  // The pattern ignores case for the keywords; a column must still be lowercase, the case that PostgreSQL gives its name.
  return column !== undefined && plainColumn.test(column) ? column : undefined
}
