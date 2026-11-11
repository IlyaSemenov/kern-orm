import type { Database } from "kern-db"

import type { MigrationDirection } from "./error"
import { getErrorMessage, MigrationError } from "./error"

/**
 * Database of a migration: its queries, scripts, and statements run in the transaction of the migration, or each in a transaction of its own for a change outside a transaction, and their unqualified names resolve in the target schema.
 *
 * `execute` returns the values of a statement as text, such as for a helper of a package that reads the catalog without the types of `kern-db/types`.
 * It lacks the other members of a `Database`, such as `close`, which a migration must not use.
 */
export type MigrationDatabase = Pick<Database, "query" | "script" | "execute">

/** Change of a step in one direction: a SQL script, or a function that runs statements on the database of the migration. */
export type MigrationChange = string | ((database: MigrationDatabase) => Promise<unknown>)

/** Step of a migration: `up` applies it, and `down` undoes it on rollback; a step without `down` does nothing on rollback. */
export interface MigrationStep {
  readonly up: MigrationChange
  readonly down?: MigrationChange
  /**
   * Changes that `migrate`, `rollback`, and `redo` run instead of `up` and `down` outside a transaction, such as `CREATE INDEX CONCURRENTLY`, which PostgreSQL rejects in a transaction block.
   *
   * Inside a transaction, such as one that creates a tenant, a test transaction, or `verifyMigrations`, the step runs `up` and `down` instead, which must build the same objects, with the same names, so `outsideTransaction.down` requires `down`.
   * A direction without a change here runs in a transaction.
   * A step with these changes must be the only step of its migration.
   * Each change must be safe to run again: after it fails, and after it succeeds but the record of the migration fails to change.
   */
  readonly outsideTransaction?: {
    readonly up?: MigrationChange
    readonly down?: MigrationChange
  }
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

/** Returns the database of the migrations of `database`, whose members join its ambient transaction or session. */
export function toMigrationDatabase(database: Database): MigrationDatabase {
  return {
    query: database.query.bind(database),
    script: database.script.bind(database),
    execute: database.execute.bind(database),
  }
}

/** Runs a change of a step on the database of the migration: a SQL script, or a function of the database. */
export async function runChange(
  database: MigrationDatabase,
  change: MigrationChange,
): Promise<void> {
  await (typeof change === "string" ? database.script(change) : change(database))
}

/**
 * Runs the changes of `direction` of the steps of migration `key` in a transaction: `up` in the order of the steps, and `down` in reverse order.
 *
 * It rejects with a `MigrationError` that names the step and the direction of a change that fails.
 */
export async function runMigrationSteps(
  database: MigrationDatabase,
  key: string,
  steps: readonly MigrationStep[],
  direction: MigrationDirection,
): Promise<void> {
  for (let position = 0; position < steps.length; position++) {
    const index = direction === "up" ? position : steps.length - 1 - position
    const change = steps[index]![direction]
    if (change === undefined) {
      continue
    }
    try {
      await runChange(database, change)
    } catch (error) {
      throw new MigrationError(
        `Migration ${key} failed in ${direction} of step ${index + 1}: ${getErrorMessage(error)}`,
        { key, step: index + 1, direction, cause: error },
      )
    }
  }
}

/** Returns the change of `direction` of migration `steps` that runs outside a transaction, or `undefined` when the direction runs in a transaction. */
export function getOutsideTransactionChange(
  steps: readonly MigrationStep[],
  direction: MigrationDirection,
): MigrationChange | undefined {
  // Loading a migration requires a step with such changes to be its only step.
  return steps[0]!.outsideTransaction?.[direction]
}

/** Runs `change` of `direction` of the only step of migration `key` outside a transaction, rejecting with a `MigrationError` that names the step and the direction. */
export async function runOutsideTransaction(
  database: MigrationDatabase,
  key: string,
  direction: MigrationDirection,
  change: MigrationChange,
): Promise<void> {
  try {
    await runChange(database, change)
  } catch (error) {
    throw new MigrationError(
      `Migration ${key} failed in ${direction} of step 1 outside a transaction: ${getErrorMessage(error)}`,
      { key, step: 1, direction, cause: error },
    )
  }
}

/**
 * Returns the steps of migration `key`, rejecting a value that is not a migration.
 *
 * `requirement` completes the message that rejects a value that is neither a step nor a non-empty array of steps, such as `be a step or a non-empty array of steps`.
 */
export function toMigrationSteps(
  key: string,
  value: unknown,
  requirement: string,
): readonly MigrationStep[] {
  const steps: readonly unknown[] = Array.isArray(value) ? value : [value]
  // An array without steps is rejected too, so that a migration that forgot its steps is never recorded as applied.
  if (typeof value !== "object" || value === null || steps.length === 0) {
    throw new MigrationError(`Migration ${key} must ${requirement}`, { key })
  }
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]
    const problem =
      findStepProblem(step) ??
      (steps.length > 1 ? findSharedStepProblem(step as MigrationStep) : undefined)
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
const stepKeys = new Set(["up", "down", "outsideTransaction"])
const outsideTransactionKeys = new Set(["up", "down"])

/** Returns what makes `value` not a step, such as `has unknown property donw`, or `undefined` for a step. */
export function findStepProblem(value: unknown): string | undefined {
  if (!isNonArrayObject(value)) {
    return "is not an object with up and an optional down"
  }
  const unknownKey = Object.keys(value).find(name => !stepKeys.has(name))
  if (unknownKey !== undefined) {
    return `has unknown property ${unknownKey}`
  }
  const { up, down, outsideTransaction } = value
  if (!isChange(up)) {
    return "requires up as a non-blank SQL script or a function"
  }
  if (down !== undefined && !isChange(down)) {
    return "requires down as a non-blank SQL script or a function, or no down"
  }
  return outsideTransaction === undefined
    ? undefined
    : findOutsideTransactionProblem(outsideTransaction, down !== undefined)
}

/**
 * Returns what keeps `step` from sharing its migration with other steps, or `undefined` for a step that can.
 *
 * A step with `outsideTransaction` must be the only step of its migration: a migration records no progress of its steps, so the changes of such a step, which no transaction rolls back, would stay after a later step fails.
 */
export function findSharedStepProblem(step: MigrationStep): string | undefined {
  return step.outsideTransaction === undefined
    ? undefined
    : "has outsideTransaction, so it must be the only step of its migration"
}

/** Returns what makes `value` not the `outsideTransaction` of a step, or `undefined` when it is one; `hasDown` tells whether the step has `down`. */
function findOutsideTransactionProblem(value: unknown, hasDown: boolean): string | undefined {
  if (!isNonArrayObject(value)) {
    return "requires outsideTransaction as an object with up, down, or both"
  }
  const unknownKey = Object.keys(value).find(name => !outsideTransactionKeys.has(name))
  if (unknownKey !== undefined) {
    return `has unknown property outsideTransaction.${unknownKey}`
  }
  const { up, down } = value
  if (up === undefined && down === undefined) {
    return "requires outsideTransaction as an object with up, down, or both"
  }
  for (const [name, change] of [
    ["up", up],
    ["down", down],
  ] as const) {
    if (change !== undefined && !isChange(change)) {
      return `requires outsideTransaction.${name} as a non-blank SQL script or a function, or no outsideTransaction.${name}`
    }
  }
  // In a transaction, the step rolls back with `down`, which must undo what `outsideTransaction.down` undoes outside one.
  if (down !== undefined && !hasDown) {
    return "has outsideTransaction.down without down, which rolls the step back in a transaction"
  }
  return undefined
}

/** Checks that `value` is an object other than an array, whose properties can be read by name. */
function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Checks that `value` is a change; blank SQL text is not one, so that a step left blank is never recorded as applied. */
function isChange(value: unknown): value is MigrationChange {
  return typeof value === "string" ? value.trim() !== "" : typeof value === "function"
}
