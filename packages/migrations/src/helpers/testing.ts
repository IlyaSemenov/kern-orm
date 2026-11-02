// Fixtures of the tests of the helpers in PostgreSQL: a schema that steps change, as the target schema of a migration.
import type { Database } from "kern-orm"

import type { MigrationStep } from "../migration"
import { runChange } from "../migration"
import { describeSchema } from "../verification/structure"

/** PostgreSQL schema that `inHelperSchema` creates. */
export const helperSchema = "migrations_helpers"

/**
 * Creates PostgreSQL schema `migrations_helpers` and runs `callback` in a nested transaction whose unqualified names resolve in it, as those of a migration resolve in its target schema.
 *
 * Call it in a test transaction, which drops the schema.
 */
export async function inHelperSchema<T>(
  database: Database,
  callback: () => Promise<T>,
): Promise<T> {
  await database.script(`CREATE SCHEMA ${helperSchema}`)
  return await database.transaction(callback, { searchPath: [helperSchema] })
}

/** Structure of a schema before a step, after its `up`, and after its `down`. */
export interface AppliedStep {
  readonly before: string[]
  readonly up: string[]
  readonly down: string[]
}

/**
 * Runs `setup` and then the `up` and the `down` of `step` in schema `migrations_helpers`, and describes the structure of the schema before `up`, after it, and after `down`.
 *
 * Call it in a test transaction.
 */
export async function applyStep(
  database: Database,
  step: MigrationStep,
  setup?: string,
): Promise<AppliedStep> {
  return await inHelperSchema(database, async () => {
    if (setup !== undefined) {
      await database.script(setup)
    }
    const before = await describeHelperSchema(database)
    await runChange(database, step.up)
    const up = await describeHelperSchema(database)
    if (step.down !== undefined) {
      await runChange(database, step.down)
    }
    return { before, up, down: await describeHelperSchema(database) }
  })
}

/** Describes the structure of schema `migrations_helpers`, naming the owners other than the role of the database. */
export async function describeHelperSchema(database: Database): Promise<string[]> {
  const { rows } = await database.execute({ text: "SELECT current_user", parameters: [] })
  return await describeSchema(database, helperSchema, rows[0]![0]!)
}
