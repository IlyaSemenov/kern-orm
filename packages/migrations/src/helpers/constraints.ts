import type { MigrationStep } from "../migration"

import { combineSteps, invertStep } from "./step"
import { alterTable } from "./tables"

/** Builds a step that adds a constraint of a SQL definition, such as `"CHECK (price > 0)"`, to a table, and drops it on rollback. */
export function addConstraint(table: string, name: string, definition: string): MigrationStep {
  return addConstraints(table, { [name]: definition })
}

/** Builds a step that drops a constraint of a table, and adds it again on rollback as `addConstraint` of the same arguments does. */
export function dropConstraint(table: string, name: string, definition: string): MigrationStep {
  return invertStep(addConstraint(table, name, definition))
}

/**
 * Builds a step that adds constraints to a table in one `ALTER TABLE`, and drops them on rollback.
 *
 * `constraints` gives the SQL definition of each constraint by its name, such as `{ form_price_check: "CHECK (price > 0)" }`.
 * List a constraint after the constraints it depends on, such as a foreign key after the unique constraint that it references, since rollback drops them in reverse order.
 * It throws when `constraints` is empty.
 */
export function addConstraints(
  table: string,
  constraints: Readonly<Record<string, string>>,
): MigrationStep {
  return alterTable(table, { addConstraints: constraints })
}

/** Builds a step that drops constraints of a table in one `ALTER TABLE`, and adds them again on rollback as `addConstraints` of the same arguments does. */
export function dropConstraints(
  table: string,
  constraints: Readonly<Record<string, string>>,
): MigrationStep {
  return invertStep(addConstraints(table, constraints))
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
