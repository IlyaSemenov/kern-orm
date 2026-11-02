import type { MigrationStep } from "../migration"
import { quoteIdentifier } from "../sql"

import { combineSteps, invertStep } from "./step"

/** Builds a step that adds a constraint of a SQL definition, such as `"CHECK (price > 0)"`, to a table, and drops it on rollback. */
export function addConstraint(table: string, name: string, definition: string): MigrationStep {
  return {
    up: `ALTER TABLE ${quoteIdentifier(table)} ADD CONSTRAINT ${quoteIdentifier(name)} ${definition}`,
    down: `ALTER TABLE ${quoteIdentifier(table)} DROP CONSTRAINT ${quoteIdentifier(name)}`,
  }
}

/** Builds a step that drops a constraint of a table, and adds it again on rollback as `addConstraint` of the same arguments does. */
export function dropConstraint(table: string, name: string, definition: string): MigrationStep {
  return invertStep(addConstraint(table, name, definition))
}

/** Builds a step that replaces the definition of a constraint of a table, keeping its name, and restores it on rollback. */
export function changeConstraint(
  table: string,
  name: string,
  from: string,
  to: string,
): MigrationStep {
  return combineSteps(dropConstraint(table, name, from), addConstraint(table, name, to))
}
