import type { MigrationStep } from "../migration"
import { endLineComment, quoteIdentifier } from "../sql"

import { invertStep } from "./step"
import { alterTable, buildAlterTable } from "./tables"

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

/** State of a column that `changeColumn` changes from or to: the properties that change, each given in both states. */
export interface ColumnState {
  /** SQL type, such as `"integer"`. */
  type?: string
  /** SQL expression that converts the values of the column to `type`, such as `"position::integer"`, for a change to this state. */
  using?: string
  notNull?: boolean
  /** SQL expression of the default, such as `"0"`, or `null` for no default. */
  default?: string | null
}

// Properties of a state that the states of a change list together, so that a missing one never means a value.
const listedProperties = ["type", "notNull", "default"] as const

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
  const describe = (problem: string) =>
    new Error(`Cannot change column ${column} of table ${table}: ${problem}`)
  for (const property of listedProperties) {
    if ((from[property] === undefined) !== (to[property] === undefined)) {
      throw describe(`give ${property} in both states or in neither`)
    }
  }
  const typeChanges = from.type !== to.type
  if (!typeChanges && (from.using !== undefined || to.using !== undefined)) {
    throw describe("using requires a change of type")
  }
  if (!typeChanges && from.notNull === to.notNull && from.default === to.default) {
    throw describe("the states change nothing")
  }
  // In one ALTER TABLE, PostgreSQL drops the default before it changes the type, and sets the default after it.
  return {
    up: buildAlterTable(table, listColumnActions(column, from, to)),
    down: buildAlterTable(table, listColumnActions(column, to, from)),
  }
}

/** Lists the `ALTER COLUMN` actions of `ALTER TABLE` that change a column from state `from` to state `to`. */
function listColumnActions(column: string, from: ColumnState, to: ColumnState): string[] {
  const typeChanges = from.type !== to.type
  const actions: string[] = []
  // PostgreSQL casts the default to the new type unless it is dropped first, which fails for a default such as `''` of a text column that becomes integer.
  if (from.default !== undefined && from.default !== null && (to.default === null || typeChanges)) {
    actions.push("DROP DEFAULT")
  }
  if (typeChanges) {
    // `USING` follows the type on its line, so a line comment at the end of the type would comment it out.
    actions.push(
      to.using === undefined
        ? `TYPE ${to.type}`
        : `TYPE ${endLineComment(to.type!)} USING ${to.using}`,
    )
  }
  if (from.notNull !== to.notNull) {
    actions.push(to.notNull ? "SET NOT NULL" : "DROP NOT NULL")
  }
  if (
    to.default !== undefined &&
    to.default !== null &&
    (to.default !== from.default || typeChanges)
  ) {
    actions.push(`SET DEFAULT ${to.default}`)
  }
  const name = quoteIdentifier(column)
  for (let index = 0; index < actions.length; index++) {
    actions[index] = `ALTER COLUMN ${name} ${actions[index]}`
  }
  return actions
}
