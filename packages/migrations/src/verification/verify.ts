// Verification of a history: each migration applies, rolls back to the structure before it, and applies again in a temporary schema, and its migration tests check how it changes data.
import type { Database, TransactionOptions } from "kern-orm"

import { getErrorMessage, MigrationError } from "../error"
import type { MigrationHistory } from "../history"
import type { MigrationDatabase, MigrationStep } from "../migration"
import { runMigrationSteps, toMigrationDatabase } from "../migration"
import { quoteIdentifier } from "../sql"
import type { MigrationTarget } from "../target"
import { isMigrationTargetDb } from "../target"

import type { MigrationTest, MigrationTestCallback } from "./migration-test"
import { describeSchema } from "./structure"
import type { MigrationTestFile, MigrationTestFiles } from "./test-files"
import { loadMigrationTests } from "./test-files"

/** Options of `verifyMigrations`. */
export interface VerifyMigrationsOptions {
  /** Files of migration tests: their directory, or their modules by path, as `import.meta.glob` returns them. */
  readonly tests?: MigrationTestFiles
}

/** Callbacks of a migration test as `runMigrationTest` calls them; loading a test checks that it has one of the forms of `MigrationTestOptions`. */
interface MigrationTestCallbacks {
  readonly setup?: MigrationTestCallback
  readonly assertUp?: MigrationTestCallback
  readonly assertDown?: MigrationTestCallback
  readonly assertUpError?: (error: MigrationError, database: MigrationDatabase) => unknown
}

/** Temporary schema of a verification. */
interface VerifiedSchema {
  readonly name: string
  /** Role that runs the verification, read before the migrations, which may set another role; its objects are described without their owner. */
  readonly ownerName: string
}

/** Migration of a history with its steps and the files of its migration tests. */
interface VerifiedMigration {
  readonly key: string
  readonly steps: readonly MigrationStep[]
  readonly testFiles: readonly MigrationTestFile[]
}

/**
 * Verifies the migrations of `history` in a temporary schema of the database of `target`, in a transaction that rolls back, nested in the enclosing one, such as a test transaction.
 *
 * In the order of the history, it applies each migration, and then rolls it back, checks that the structure of the schema is the same as before the migration, runs the migration tests of the migration, and applies it again.
 * It rejects at the first failure with an error that names the migration, and the migration test and its stage for an error of a test.
 * It loads the migrations and the migration tests before it runs any, rejecting a file of migration tests that matches no migration.
 */
export async function verifyMigrations(
  target: MigrationTarget,
  history: MigrationHistory,
  options: VerifyMigrationsOptions = {},
): Promise<void> {
  // A history without migrations comes from a pattern or a directory that matches no file, more likely than from a project without migrations.
  if (history.keys.length === 0) {
    throw new Error("Cannot verify a history without migrations")
  }
  const testFiles =
    options.tests === undefined ? undefined : await loadMigrationTests(options.tests, history.keys)
  const migrations: VerifiedMigration[] = []
  for (const key of history.keys) {
    migrations.push({ key, steps: await history.load(key), testFiles: testFiles?.get(key) ?? [] })
  }
  const database = isMigrationTargetDb(target) ? target.$database : target
  const schemaName = createSchemaName()
  await runRolledBack(
    database,
    async () => {
      const schema = { name: schemaName, ownerName: await getCurrentUser(database) }
      await database.script(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`)
      let before = await describeSchema(database, schema.name, schema.ownerName)
      for (const migration of migrations) {
        before = await verifyMigration(database, schema, migration, before)
      }
    },
    // The search path of the migrations, as `migrate` gives it to a target in the temporary schema.
    { searchPath: [schemaName, ...history.searchPath] },
  )
}

/**
 * Applies a migration to the schema and checks its rollback, its migration tests, and its second `up` in a nested transaction that rolls back; returns the structure of the schema after the migration.
 *
 * It does not compare the structure after the second `up`, which differs from that after the first one only for an `up` that depends on something other than the structure, such as data.
 */
async function verifyMigration(
  database: Database,
  schema: VerifiedSchema,
  migration: VerifiedMigration,
  before: readonly string[],
): Promise<string[]> {
  const { key, steps } = migration
  const migrationDatabase = toMigrationDatabase(database)
  await runMigrationSteps(migrationDatabase, key, steps, "up")
  const after = await describeSchema(database, schema.name, schema.ownerName)
  await runRolledBack(database, async () => {
    await runMigrationSteps(migrationDatabase, key, steps, "down")
    checkStructure(key, before, await describeSchema(database, schema.name, schema.ownerName))
    for (const file of migration.testFiles) {
      for (const test of file.tests) {
        await runRolledBack(database, () => runMigrationTest(database, migration, file, test))
      }
    }
    try {
      await runMigrationSteps(migrationDatabase, key, steps, "up")
    } catch (error) {
      throw new Error(
        `Migration ${key} fails to apply again after its rollback: ${getErrorMessage(error)}`,
        { cause: error },
      )
    }
  })
  return after
}

/** Rejects a structure after the rollback of migration `key` that differs from the structure before the migration, listing the lines that differ. */
function checkStructure(key: string, before: readonly string[], after: readonly string[]): void {
  const beforeLines = new Set(before)
  const afterLines = new Set(after)
  const missing = before.filter(line => !afterLines.has(line))
  const left = after.filter(line => !beforeLines.has(line))
  if (missing.length === 0 && left.length === 0) {
    return
  }
  const lines = [
    `Rolling back migration ${key} does not restore the structure of the schema (- before the migration, + after its rollback):`,
  ]
  for (const line of missing) {
    lines.push(formatDiffLine("-", line))
  }
  for (const line of left) {
    lines.push(formatDiffLine("+", line))
  }
  throw new Error(lines.join("\n"))
}

/** Formats a line of a structure in a diff, indenting the continuation lines of a definition, such as of a function. */
function formatDiffLine(sign: string, line: string): string {
  return `  ${sign} ${line.replaceAll("\n", "\n    ")}`
}

/**
 * Runs a migration test of a migration on the schema before the migration: `setup`, `up`, `assertUp`, `down`, `assertDown`, and `up` again, or `setup`, `up` that must fail, and `assertUpError`.
 *
 * It rejects with an error that names the test, its file, and the stage that failed.
 */
async function runMigrationTest(
  database: Database,
  migration: VerifiedMigration,
  file: MigrationTestFile,
  test: MigrationTest,
): Promise<void> {
  const { key, steps } = migration
  const migrationDatabase = toMigrationDatabase(database)
  const name = `Migration test "${test.name}" in ${file.path}`
  const runStage = async (stage: string, callback: () => unknown) => {
    try {
      await callback()
    } catch (error) {
      throw new Error(`${name} failed in ${stage}: ${getErrorMessage(error)}`, { cause: error })
    }
  }
  const { setup, assertUp, assertDown, assertUpError } = test as MigrationTestCallbacks
  await runStage("setup", () => setup?.(migrationDatabase))
  if (assertUpError !== undefined) {
    // A nested transaction keeps the transaction of the test usable after `up` fails, for `assertUpError` to query.
    const upError = await database
      .transaction(() => runMigrationSteps(migrationDatabase, key, steps, "up"))
      .then(
        () => undefined,
        (error: unknown) => error,
      )
    if (upError === undefined) {
      throw new Error(`${name} expects up to fail, but it applied`)
    }
    if (!(upError instanceof MigrationError)) {
      throw new Error(`${name} failed in up: ${getErrorMessage(upError)}`, { cause: upError })
    }
    await runStage("assertUpError", () => assertUpError(upError, migrationDatabase))
    return
  }
  await runStage("up", () => runMigrationSteps(migrationDatabase, key, steps, "up"))
  await runStage("assertUp", () => assertUp?.(migrationDatabase))
  await runStage("down", () => runMigrationSteps(migrationDatabase, key, steps, "down"))
  await runStage("assertDown", () => assertDown?.(migrationDatabase))
  await runStage("up again", () => runMigrationSteps(migrationDatabase, key, steps, "up"))
}

/** Value that a callback of `runRolledBack` throws to roll back its transaction after it succeeds. */
const rollbackSignal = Symbol("rollback")

/** Runs `callback` in a transaction, nested in the enclosing one, if any, and rolls it back after the callback succeeds too. */
async function runRolledBack(
  database: Database,
  callback: () => Promise<void>,
  options?: TransactionOptions,
): Promise<void> {
  try {
    await database.transaction(async () => {
      await callback()
      throw rollbackSignal
    }, options)
  } catch (error) {
    if (error !== rollbackSignal) {
      throw error
    }
  }
}

/** Reads the role that runs the statements of the database, `current_user`. */
async function getCurrentUser(database: Database): Promise<string> {
  const { rows } = await database.execute({ text: "SELECT current_user", parameters: [] })
  return rows[0]![0]!
}

/** Creates a name of a temporary schema with a random suffix, so that verifications in parallel processes do not wait for each other's schema. */
function createSchemaName(): string {
  return `kern_verify_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`
}
