import type { MigrationChange, MigrationDatabase, MigrationStep } from "../migration"
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
  /**
   * Builds and drops the index without blocking writes to the table, with `CREATE INDEX CONCURRENTLY` and `DROP INDEX CONCURRENTLY`, when `migrate`, `rollback`, or `redo` runs outside a transaction; inside a transaction, the step builds and drops the index as without this option.
   *
   * A build after a failed one first drops the index that the failed build left not valid; a valid index of the name on the table counts as built.
   * PostgreSQL rejects it for a partitioned table.
   */
  concurrently?: boolean
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
  const name = options.name ?? getIndexName(table, columns, include)
  const quotedName = quoteIdentifier(name)
  let definition = `${quotedName} ON ${quoteIdentifier(table)}`
  if (options.using !== undefined) {
    definition += ` USING ${options.using}`
  }
  definition += ` (${columns.join(", ")})`
  if (include.length > 0) {
    definition += ` INCLUDE (${include.join(", ")})`
  }
  if (options.nullsNotDistinct) {
    definition += " NULLS NOT DISTINCT"
  }
  if (options.where !== undefined) {
    definition += ` WHERE ${options.where}`
  }
  const index = options.unique ? "UNIQUE INDEX" : "INDEX"
  const up = `CREATE ${index} ${definition}`
  const down = `DROP INDEX ${quotedName}`
  if (!options.concurrently) {
    return { up, down }
  }
  return {
    up,
    down,
    outsideTransaction: {
      up: buildIndexConcurrently(table, name, `CREATE ${index} CONCURRENTLY ${definition}`),
      down: dropIndexConcurrently(table, name),
    },
  }
}

/**
 * Builds a step that drops an index of a table, and creates it again on rollback as `createIndex` of the same arguments does.
 *
 * It drops the index of the name that `createIndex` gives it, and with `concurrently`, drops and builds it as `createIndex` does.
 */
export function dropIndex(
  table: string,
  columns: readonly string[],
  options: IndexOptions = {},
): MigrationStep {
  return invertStep(createIndex(table, columns, options))
}

/**
 * Returns the change that builds index `name` of `table` with `create`, a `CREATE INDEX CONCURRENTLY`, unless the table has a valid index of the name.
 *
 * A valid index of the name counts as built, since an earlier attempt that built it may have failed to record the migration.
 * An index of the name that is not valid, which a failed build leaves, is dropped first, since `CREATE INDEX` fails on its name, and `IF NOT EXISTS` would keep it.
 */
function buildIndexConcurrently(table: string, name: string, create: string): MigrationChange {
  return async database => {
    const index = await findIndex(database, table, name)
    if (index === "valid") {
      return
    }
    if (index === "invalid") {
      await database.script(`DROP INDEX CONCURRENTLY ${quoteIdentifier(name)}`)
    }
    await database.script(create)
  }
}

/** Returns the change that drops index `name` of `table` with `DROP INDEX CONCURRENTLY`, and does nothing when the index is missing, such as after an earlier attempt that dropped it. */
function dropIndexConcurrently(table: string, name: string): MigrationChange {
  return async database => {
    if ((await findIndex(database, table, name)) !== "missing") {
      await database.script(`DROP INDEX CONCURRENTLY ${quoteIdentifier(name)}`)
    }
  }
}

/**
 * Returns whether index `name` of `table` is missing, valid, or not valid.
 *
 * It finds the index by its name through the search path, as `DROP INDEX` does, so that `DROP INDEX` drops the index that it found, and the table as `CREATE INDEX` does.
 *
 * It throws when the name finds another relation, such as an index of another table, also in an earlier schema of the search path, where it hides the index of the table: building would create an index that dropping cannot find, and dropping would leave the index while the migration is recorded as rolled back.
 * It checks the catalog rather than using `IF [NOT] EXISTS`, which sends a notice.
 */
async function findIndex(
  database: MigrationDatabase,
  table: string,
  name: string,
): Promise<"missing" | "valid" | "invalid"> {
  // `execute` returns the state as text, which needs no types of kern-orm to decode.
  // `to_regclass` truncates a name to 63 bytes, as PostgreSQL truncates a name in DDL.
  const { rows } = await database.execute({
    text: `
      SELECT CASE
        WHEN pg_catalog.to_regclass($1) IS NULL THEN 'missing'
        WHEN NOT EXISTS (
          SELECT FROM pg_catalog.pg_index
          WHERE indexrelid = pg_catalog.to_regclass($1) AND indrelid = pg_catalog.to_regclass($2)
        ) THEN 'other'
        WHEN (SELECT indisvalid FROM pg_catalog.pg_index WHERE indexrelid = pg_catalog.to_regclass($1))
          THEN 'valid'
        ELSE 'invalid'
      END
    `,
    parameters: [quoteIdentifier(name), quoteIdentifier(table)],
  })
  const state = rows[0]![0]
  if (state === "other") {
    throw new Error(
      `Index name ${name} finds a relation other than an index of table ${table} through the search path`,
    )
  }
  return state as "missing" | "valid" | "invalid"
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
