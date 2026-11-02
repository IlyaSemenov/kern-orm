import type { MigrationStep } from "../migration"
import { quoteIdentifier } from "../sql"

import { invertStep } from "./step"

/** Options of `createTable` and `dropTable`. */
export interface TableOptions {
  /** Constraints of the table by name, each a SQL definition, such as `{ form_field_position_key: "UNIQUE (form_id, position)" }`. */
  constraints?: Readonly<Record<string, string>>
}

/**
 * Builds a step that creates a table, and drops it on rollback.
 *
 * `columns` gives the SQL definition of each column by its name, such as `{ name: "text NOT NULL" }`.
 */
export function createTable(
  table: string,
  columns: Readonly<Record<string, string>>,
  options: TableOptions = {},
): MigrationStep {
  const lines: string[] = []
  for (const [column, definition] of Object.entries(columns)) {
    lines.push(`${quoteIdentifier(column)} ${definition}`)
  }
  for (const [name, definition] of Object.entries(options.constraints ?? {})) {
    lines.push(`CONSTRAINT ${quoteIdentifier(name)} ${definition}`)
  }
  return {
    up: `CREATE TABLE ${quoteIdentifier(table)} (\n  ${lines.join(",\n  ")}\n)`,
    down: `DROP TABLE ${quoteIdentifier(table)}`,
  }
}

/**
 * Builds a step that drops a table, and creates it again on rollback as `createTable` of the same arguments does.
 *
 * Rollback restores neither the rows of the table nor its indexes and constraints that the arguments do not describe.
 */
export function dropTable(
  table: string,
  columns: Readonly<Record<string, string>>,
  options: TableOptions = {},
): MigrationStep {
  return invertStep(createTable(table, columns, options))
}

/** Builds a step that renames a table, and renames it back on rollback. */
export function renameTable(from: string, to: string): MigrationStep {
  return {
    up: `ALTER TABLE ${quoteIdentifier(from)} RENAME TO ${quoteIdentifier(to)}`,
    down: `ALTER TABLE ${quoteIdentifier(to)} RENAME TO ${quoteIdentifier(from)}`,
  }
}
