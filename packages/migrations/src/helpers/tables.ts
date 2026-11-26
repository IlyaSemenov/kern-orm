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

/** Changes of a table that `alterTable` makes, each a record of the SQL definitions of columns or constraints by name. */
export interface TableChanges {
  /** Columns to drop, with their definitions for rollback. */
  dropColumns?: Readonly<Record<string, string>>
  /** Constraints to drop, with their definitions for rollback. */
  dropConstraints?: Readonly<Record<string, string>>
  /** Columns to add, such as `{ slug: "text" }`. */
  addColumns?: Readonly<Record<string, string>>
  /** Constraints to add, such as `{ form_price_check: "CHECK (price > 0)" }`. */
  addConstraints?: Readonly<Record<string, string>>
}

const tableChangeKeys = /* @__PURE__ */ new Set([
  "dropColumns",
  "dropConstraints",
  "addColumns",
  "addConstraints",
])

/**
 * Builds a step that drops and adds columns and constraints of a table in one `ALTER TABLE`, and undoes them on rollback: it drops what the step adds, and adds again what the step drops.
 *
 * It drops before it adds, so dropping and adding a constraint of the same name replaces its definition.
 * List a column or a constraint after those of its record it depends on, such as a generated column after the columns of its expression, since the step and its rollback drop them in reverse order.
 * When the step adds or drops both a foreign key and the unique constraint that it references, list both in `addConstraints` or `dropConstraints`, the unique constraint first, rather than the foreign key as `REFERENCES` in the definition of a column, since both directions drop constraints before columns.
 * Rollback recreates the columns and constraints of `dropColumns` and `dropConstraints` from their definitions; it does not restore the values of the columns.
 * It throws for an unknown change and when the changes are empty.
 */
export function alterTable(table: string, changes: TableChanges): MigrationStep {
  const unknownKey = Object.keys(changes).find(key => !tableChangeKeys.has(key))
  if (unknownKey !== undefined) {
    throw new Error(`Cannot alter table ${table}: unknown change ${unknownKey}`)
  }
  const up: string[] = []
  const down: string[] = []
  // A dropped constraint goes before a dropped column, since dropping a column drops its constraints, which would then be missing.
  pushDrops(up, "CONSTRAINT", changes.dropConstraints)
  pushDrops(up, "COLUMN", changes.dropColumns)
  pushAdds(up, "COLUMN", changes.addColumns)
  pushAdds(up, "CONSTRAINT", changes.addConstraints)
  pushDrops(down, "CONSTRAINT", changes.addConstraints)
  pushDrops(down, "COLUMN", changes.addColumns)
  pushAdds(down, "COLUMN", changes.dropColumns)
  pushAdds(down, "CONSTRAINT", changes.dropConstraints)
  if (up.length === 0) {
    throw new Error(`Cannot alter table ${table}: the changes are empty`)
  }
  return { up: buildAlterTable(table, up), down: buildAlterTable(table, down) }
}

/** Appends to `actions` an action that adds each column or constraint of `definitions`, in order. */
function pushAdds(
  actions: string[],
  kind: "COLUMN" | "CONSTRAINT",
  definitions: Readonly<Record<string, string>> | undefined,
): void {
  if (definitions === undefined) {
    return
  }
  for (const [name, definition] of Object.entries(definitions)) {
    actions.push(`ADD ${kind} ${quoteIdentifier(name)} ${definition}`)
  }
}

/**
 * Appends to `actions` an action that drops each column or constraint of `definitions`, in reverse order.
 *
 * PostgreSQL drops them one by one and rejects dropping one that another depends on, so the reverse order drops a dependent one first, such as a generated column before the columns of its expression.
 */
function pushDrops(
  actions: string[],
  kind: "COLUMN" | "CONSTRAINT",
  definitions: Readonly<Record<string, string>> | undefined,
): void {
  if (definitions === undefined) {
    return
  }
  const names = Object.keys(definitions)
  for (let index = names.length - 1; index >= 0; index--) {
    actions.push(`DROP ${kind} ${quoteIdentifier(names[index]!)}`)
  }
}

/**
 * Builds one `ALTER TABLE` of a table with its actions in their order, such as `ADD COLUMN "slug" text`.
 *
 * It ends an action before another with a line break when the action contains `--`, so that a line comment at its end does not comment out the actions after it.
 */
function buildAlterTable(table: string, actions: readonly string[]): string {
  let sql = `ALTER TABLE ${quoteIdentifier(table)} `
  for (let index = 0; index < actions.length; index++) {
    sql += index < actions.length - 1 ? `${endLineComment(actions[index]!)}, ` : actions[index]!
  }
  return sql
}
