import { getErrorMessage, MigrationError } from "./error"
import type { MigrationStep } from "./migration"
import { toMigrationSteps } from "./migration"

/** Loader of a migration module, such as `() => import("./migrations/0001_create_form.ts")`, or one that `import.meta.glob` returns. */
export type MigrationLoader = () => Promise<unknown>

/** Options of `defineMigrations`. */
export interface MigrationHistoryOptions {
  /** Name of the table of the applied migrations in the target schema, `kern_migration` by default. */
  tableName?: string
  /** PostgreSQL schemas that the search path of the migrations lists after the target schema, such as the schema of extensions. */
  searchPath?: readonly string[]
}

/** History of migrations: their keys in order, and how a target keeps the applied ones. */
export interface MigrationHistory {
  /** Keys of the migrations in the order of their numbers. */
  readonly keys: readonly string[]
  /** Name of the table of the applied migrations in the target schema. */
  readonly tableName: string
  /** PostgreSQL schemas that the search path of the migrations lists after the target schema. */
  readonly searchPath: readonly string[]
  /**
   * Loads the module of the migration of `key` and returns its steps.
   *
   * It rejects with a `MigrationError` when the module fails to load or does not export a migration.
   */
  load(key: string): Promise<readonly MigrationStep[]>
}

/** Migration of a history. */
interface HistoryEntry {
  readonly key: string
  readonly number: bigint
  readonly load: MigrationLoader
}

const keyPattern = /^(\d+)_[^.\s]+$/

/** Returns the number of migration key `key` of the form `<number>_<name>`, or `undefined` for a key of another form. */
export function getMigrationNumber(key: string): bigint | undefined {
  const match = keyPattern.exec(key)
  return match ? BigInt(match[1]!) : undefined
}

/** Compares migration numbers for sorting. */
export function compareMigrationNumbers(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Defines a history of migrations from the loaders of their modules, by key or by path, as `import.meta.glob` returns them.
 *
 * A key is the file name without directories and extension, of the form `<number>_<name>`, such as `0001_create_form`, and the numbers order the history.
 * It rejects a key of another form and two keys of one number, such as migrations of two branches that took one number.
 */
export function defineMigrations(
  loaders: Readonly<Record<string, MigrationLoader>>,
  options: MigrationHistoryOptions = {},
): MigrationHistory {
  const entries: HistoryEntry[] = []
  for (const [name, load] of Object.entries(loaders)) {
    const key = name.includes("/") ? getFileKey(name) : name
    const number = getMigrationNumber(key)
    if (number === undefined) {
      throw new Error(
        `Migration ${name} must be named <number>_<name>, such as 0001_create_form, without dots`,
      )
    }
    entries.push({ key, number, load })
  }
  entries.sort((left, right) => compareMigrationNumbers(left.number, right.number))
  const byKey = new Map<string, HistoryEntry>()
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!
    const previous = entries[index - 1]
    if (previous !== undefined && previous.number === entry.number) {
      throw new Error(
        `Migrations ${previous.key} and ${entry.key} have the same number: give each migration its own number`,
      )
    }
    byKey.set(entry.key, entry)
  }

  return {
    keys: Object.freeze(entries.map(entry => entry.key)),
    tableName: options.tableName ?? "kern_migration",
    searchPath: Object.freeze([...(options.searchPath ?? [])]),
    async load(key) {
      const entry = byKey.get(key)
      if (entry === undefined) {
        throw new Error(`The history has no migration ${key}`)
      }
      let module: unknown
      try {
        module = await entry.load()
      } catch (error) {
        throw new MigrationError(`Cannot load migration ${key}: ${getErrorMessage(error)}`, {
          key,
          cause: error,
        })
      }
      return toMigrationSteps(
        key,
        typeof module === "object" && module !== null
          ? (module as { default?: unknown }).default
          : undefined,
      )
    },
  }
}

/** Returns the key of a migration module at `path`: its file name without directories and extension. */
function getFileKey(path: string): string {
  const fileName = path.slice(path.lastIndexOf("/") + 1)
  const dot = fileName.lastIndexOf(".")
  return dot > 0 ? fileName.slice(0, dot) : fileName
}
