import type { MigrationStep } from "../migration"
import { quoteIdentifier } from "../sql"

import { invertStep } from "./step"

/** Builds a step that adds a column of a SQL definition, such as `"text NOT NULL DEFAULT ''"`, to a table, and drops it on rollback. */
export function addColumn(table: string, column: string, definition: string): MigrationStep {
  return {
    up: `ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${quoteIdentifier(column)} ${definition}`,
    down: `ALTER TABLE ${quoteIdentifier(table)} DROP COLUMN ${quoteIdentifier(column)}`,
  }
}

/**
 * Builds a step that drops a column of a table, and adds it again on rollback as `addColumn` of the same arguments does.
 *
 * Rollback restores neither the values of the column nor the indexes and constraints on it that its definition does not describe.
 */
export function dropColumn(table: string, column: string, definition: string): MigrationStep {
  return invertStep(addColumn(table, column, definition))
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
  return {
    up: alterColumn(table, column, from, to),
    down: alterColumn(table, column, to, from),
  }
}

/** Builds `ALTER TABLE` of the actions that change a column from state `from` to state `to`. */
function alterColumn(table: string, column: string, from: ColumnState, to: ColumnState): string {
  const typeChanges = from.type !== to.type
  const actions: string[] = []
  // PostgreSQL casts the default to the new type unless it is dropped first, which fails for a default such as `''` of a text column that becomes integer.
  if (from.default !== undefined && from.default !== null && (to.default === null || typeChanges)) {
    actions.push("DROP DEFAULT")
  }
  if (typeChanges) {
    actions.push(`TYPE ${to.type}${to.using === undefined ? "" : ` USING ${to.using}`}`)
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
  // In one ALTER TABLE, PostgreSQL drops the default before it changes the type, and sets the default after it.
  const name = quoteIdentifier(column)
  return `ALTER TABLE ${quoteIdentifier(table)} ${actions.map(action => `ALTER COLUMN ${name} ${action}`).join(", ")}`
}
