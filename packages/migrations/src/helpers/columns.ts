import type { MigrationStep } from "../migration"
import { quoteIdentifier } from "../sql"

import type { ColumnChange, ColumnState } from "./column-changes"
import { invertStep } from "./step"
import { alterTable } from "./tables"

/** Builds a step that adds a column of a SQL definition, such as `"text NOT NULL DEFAULT ''"`, to a table, and drops it on rollback. */
export function addColumn(table: string, column: string, definition: string): MigrationStep {
  return addColumns(table, { [column]: definition })
}

/**
 * Builds a step that drops a column of a table, and adds it again on rollback as `addColumn` of the same arguments does.
 *
 * Rollback restores neither the values of the column nor the indexes and constraints on it that its definition does not describe.
 */
export function dropColumn(table: string, column: string, definition: string): MigrationStep {
  return invertStep(addColumn(table, column, definition))
}

/**
 * Builds a step that adds columns to a table in one `ALTER TABLE`, and drops them on rollback.
 *
 * `columns` gives the SQL definition of each column by its name, such as `{ slug: "text", position: "integer NOT NULL DEFAULT 0" }`.
 * List a column after the columns it depends on, such as a generated column after the columns of its expression, since rollback drops them in reverse order.
 * It throws when `columns` is empty.
 */
export function addColumns(
  table: string,
  columns: Readonly<Record<string, string>>,
): MigrationStep {
  return alterTable(table, { addColumns: columns })
}

/**
 * Builds a step that drops columns of a table in one `ALTER TABLE`, and adds them again on rollback as `addColumns` of the same arguments does.
 *
 * Rollback restores neither the values of the columns nor the indexes and constraints on them that their definitions do not describe.
 */
export function dropColumns(
  table: string,
  columns: Readonly<Record<string, string>>,
): MigrationStep {
  return invertStep(addColumns(table, columns))
}

/** Builds a step that renames a column of a table, and renames it back on rollback. */
export function renameColumn(table: string, from: string, to: string): MigrationStep {
  return {
    up: `ALTER TABLE ${quoteIdentifier(table)} RENAME COLUMN ${quoteIdentifier(from)} TO ${quoteIdentifier(to)}`,
    down: `ALTER TABLE ${quoteIdentifier(table)} RENAME COLUMN ${quoteIdentifier(to)} TO ${quoteIdentifier(from)}`,
  }
}

/**
 * Builds a step that changes the type, the nullability, or the default of a column from state `from` to state `to`, and changes it back on rollback.
 *
 * A property that changes must be in both states, and `using` of a state requires a change of type: `up` converts the values with `using` of `to`, and `down` with that of `from`.
 * It throws when the states change nothing.
 */
export function changeColumn(
  table: string,
  column: string,
  from: ColumnState,
  to: ColumnState,
): MigrationStep {
  return changeColumns(table, { [column]: [from, to] })
}

/**
 * Builds a step that changes columns of a table in one `ALTER TABLE`, each as `changeColumn` does, and changes them back on rollback.
 *
 * `columns` gives the states of each column before and after the change by its name, such as `{ status: [{ notNull: false }, { notNull: true }] }`.
 * PostgreSQL rewrites the table at most once for all changes of type, and `using` of a column reads the values of the other columns before the change.
 * It throws when `columns` is empty and for a change that `changeColumn` rejects.
 */
export function changeColumns(
  table: string,
  columns: Readonly<Record<string, ColumnChange>>,
): MigrationStep {
  return alterTable(table, { changeColumns: columns })
}
