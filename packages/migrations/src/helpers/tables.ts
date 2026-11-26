import type { MigrationStep } from "../migration"
import { endLineComment, quoteIdentifier } from "../sql"

import { createSingletonIndex } from "./indexes"
import { combineSteps, invertStep } from "./step"

/** Options of `createTable` and `dropTable`. */
export interface TableOptions {
  /** Constraints of the table by name, each a SQL definition, such as `{ form_field_position_key: "UNIQUE (form_id, position)" }`. */
  constraints?: Readonly<Record<string, string>>
  /** Keeps the table to at most one row with its singleton index, as `createSingletonIndex` of the table without `name` creates it. */
  singleton?: boolean
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
  const step: MigrationStep = {
    up: `CREATE TABLE ${quoteIdentifier(table)} (\n  ${lines.join(",\n  ")}\n)`,
    down: `DROP TABLE ${quoteIdentifier(table)}`,
  }
  return options.singleton ? combineSteps(step, createSingletonIndex(table)) : step
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

/**
 * Builds one `ALTER TABLE` of a table with its actions in their order, such as `ADD COLUMN "slug" text`.
 *
 * It ends an action before another with a line break when the action contains `--`, so that a line comment at its end does not comment out the actions after it.
 */
export function buildAlterTable(table: string, actions: readonly string[]): string {
  let sql = `ALTER TABLE ${quoteIdentifier(table)} `
  for (let index = 0; index < actions.length; index++) {
    sql += index < actions.length - 1 ? `${endLineComment(actions[index]!)}, ` : actions[index]!
  }
  return sql
}
