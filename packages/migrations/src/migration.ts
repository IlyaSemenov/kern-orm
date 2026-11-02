import type { Database } from "kern-orm"

import { MigrationError } from "./error"

/**
 * Database of a migration: its queries and scripts run in the transaction of the migration, and their unqualified names resolve in the target schema.
 *
 * It lacks the other members of a `Database`, such as `close`, which a migration must not use.
 */
export type MigrationDatabase = Pick<Database, "query" | "script">

/** Change of a step in one direction: a SQL script, or a function that runs statements on the database of the migration. */
export type MigrationChange = string | ((database: MigrationDatabase) => Promise<unknown>)

/** Step of a migration: `up` applies it, and `down` undoes it on rollback; a step without `down` does nothing on rollback. */
export interface MigrationStep {
  readonly up: MigrationChange
  readonly down?: MigrationChange
}

/** Migration: a step, or steps that apply in their order and roll back in reverse order. */
export type Migration = MigrationStep | readonly MigrationStep[]

/**
 * Defines a migration, the default export of a migration module.
 *
 * A migration is a plain value: it never imports the tables, types, or database of the application, so that it does the same on every target and in every later version of the application.
 */
export function defineMigration(migration: Migration): Migration {
  return migration
}

/** Runs a change of a step on the database of the migration: a SQL script, or a function of the database. */
export async function runChange(
  database: MigrationDatabase,
  change: MigrationChange,
): Promise<void> {
  await (typeof change === "string" ? database.script(change) : change(database))
}

/** Returns the steps of the default export of the module of migration `key`, rejecting a value that is not a migration. */
export function toMigrationSteps(key: string, value: unknown): readonly MigrationStep[] {
  const steps: readonly unknown[] = Array.isArray(value) ? value : [value]
  // An array without steps is rejected too, so that a migration that forgot its steps is never recorded as applied.
  if (typeof value !== "object" || value === null || steps.length === 0) {
    throw new MigrationError(
      `Migration ${key} must export a step or a non-empty array of steps as its default export`,
      { key },
    )
  }
  for (let index = 0; index < steps.length; index++) {
    const problem = findStepProblem(steps[index])
    if (problem !== undefined) {
      throw new MigrationError(`Step ${index + 1} of migration ${key} ${problem}`, {
        key,
        step: index + 1,
      })
    }
  }
  return steps as readonly MigrationStep[]
}

// A step has only these properties, so that a misspelled `down` rejects instead of doing nothing on rollback.
const stepKeys = new Set(["up", "down"])

/** Returns what makes `value` not a step, such as `has unknown property donw`, or `undefined` for a step. */
export function findStepProblem(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "is not an object with up and an optional down"
  }
  const unknownKey = Object.keys(value).find(name => !stepKeys.has(name))
  if (unknownKey !== undefined) {
    return `has unknown property ${unknownKey}`
  }
  const { up, down } = value as Record<string, unknown>
  if (!isChange(up)) {
    return "requires up as a non-blank SQL script or a function"
  }
  if (down !== undefined && !isChange(down)) {
    return "requires down as a non-blank SQL script or a function, or no down"
  }
  return undefined
}

/** Checks that `value` is a change; blank SQL text is not one, so that a step left blank, such as of the template of a new migration, is never recorded as applied. */
function isChange(value: unknown): value is MigrationChange {
  return typeof value === "string" ? value.trim() !== "" : typeof value === "function"
}
