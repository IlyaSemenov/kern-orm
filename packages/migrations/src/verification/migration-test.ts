// Migration tests: checks of how a migration changes the data of a schema, which the verification of a history runs.
import type { MigrationError } from "../error"
import type { MigrationDatabase } from "../migration"

/** Callback of a migration test that prepares or checks the data of the schema through the database of the migration. */
export type MigrationTestCallback = (database: MigrationDatabase) => unknown

/** Type that rejects `assertUpError` of a migration test together with `assertUp` or `assertDown`. */
export interface AssertUpErrorConflict {
  readonly "a migration test with assertUpError has no assertUp or assertDown": never
}

/** Options of a migration test that checks the data after the migration applies and after it rolls back. */
export interface MigrationDataTestOptions {
  /** Prepares the data of the schema before the migration. */
  readonly setup?: MigrationTestCallback
  /** Checks the data after `up` of the migration. */
  readonly assertUp?: MigrationTestCallback
  /** Checks the data after `down` of the migration, which follows `up`. */
  readonly assertDown?: MigrationTestCallback
  readonly assertUpError?: AssertUpErrorConflict
}

/** Options of a migration test that checks that the migration fails to apply to the data of `setup`. */
export interface MigrationErrorTestOptions {
  /** Prepares the data of the schema before the migration. */
  readonly setup?: MigrationTestCallback
  /** Checks the error of `up` of the migration, with which `migrate` would reject. */
  readonly assertUpError: (error: MigrationError, database: MigrationDatabase) => unknown
  readonly assertUp?: AssertUpErrorConflict
  readonly assertDown?: AssertUpErrorConflict
}

/** Options of a migration test: of one that checks the data after the migration, or of one that checks that the migration fails. */
export type MigrationTestOptions = MigrationDataTestOptions | MigrationErrorTestOptions

/** Migration test: a plain value that `defineMigrationTest` returns, the default export of a file of migration tests alone or in an array. */
export type MigrationTest = MigrationTestOptions & { readonly name: string }

/**
 * Defines a migration test named `name`, the default export of a file of migration tests beside its migration, alone or in an array.
 *
 * Like a migration, a migration test never imports the tables of the application, which describe the latest schema rather than the schema of its migration.
 * It throws for an unknown property, such as a misspelled `assertDown`, which would never run, and for `assertUpError` together with `assertUp` or `assertDown`.
 */
export function defineMigrationTest(name: string, test: MigrationTestOptions): MigrationTest {
  const value: MigrationTest = { ...test, name }
  const problem = findMigrationTestProblem(value)
  if (problem !== undefined) {
    throw new Error(`Migration test "${name}" ${problem}`)
  }
  return value
}

const testKeys = new Set(["name", "setup", "assertUp", "assertDown", "assertUpError"])
const callbackKeys = ["setup", "assertUp", "assertDown", "assertUpError"] as const

/** Returns what makes `value` not a migration test, such as `has unknown property assertDonw`, or `undefined` for a migration test. */
export function findMigrationTestProblem(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "is not an object with a name and callbacks"
  }
  const unknownKey = Object.keys(value).find(key => !testKeys.has(key))
  if (unknownKey !== undefined) {
    return `has unknown property ${unknownKey}`
  }
  const test = value as Record<string, unknown>
  if (typeof test.name !== "string" || test.name.trim() === "") {
    return "requires a non-blank name"
  }
  let hasCallback = false
  for (const key of callbackKeys) {
    if (test[key] !== undefined) {
      if (typeof test[key] !== "function") {
        return `requires ${key} as a function`
      }
      hasCallback = true
    }
  }
  if (!hasCallback) {
    return "requires setup, assertUp, assertDown, or assertUpError"
  }
  // `assertUp` and `assertDown` need `up` to apply, which a test with `assertUpError` requires to fail.
  if (
    test.assertUpError !== undefined &&
    (test.assertUp !== undefined || test.assertDown !== undefined)
  ) {
    return "has assertUpError together with assertUp or assertDown"
  }
  return undefined
}
