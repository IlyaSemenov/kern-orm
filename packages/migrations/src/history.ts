import { getErrorMessage, MigrationError, nameMigration } from "./error"
import { getMigrationTestKey } from "./files"
import type { Migration, MigrationStep } from "./migration"
import { toMigrationSteps } from "./migration"

/** Loader of a migration module, such as `() => import("./migrations/0001_create_form.ts")`, or one that `import.meta.glob` returns. */
export type MigrationLoader = () => Promise<unknown>

/**
 * Baseline of a history: a migration without a key that takes an empty target to the state that the migrations it replaces build one by one.
 *
 * A target without applied migrations runs it instead of them, and a target that has applied them needs nothing of it.
 */
export interface MigrationBaselineOptions {
  /** Loader of the module of the baseline, such as `() => import("./baseline.ts")`, or the baseline itself; it has no changes outside a transaction. */
  migration: MigrationLoader | Migration
  /**
   * Keys of the migrations that the baseline replaces, in order, down to the last one, whose state the baseline builds.
   *
   * It lists all of them at first; remove keys from its start, and the modules of replaced migrations, once every target has applied them and no version of the application that lists them runs.
   * The history may keep the modules of the last replaced migrations, of all of them or of none, without a gap.
   */
  replaces: readonly string[]
}

/** Options of `defineMigrations`. */
export interface MigrationHistoryOptions {
  /** Name of the table of versions in the target schema, which keeps the keys of the migrations whose changes the schema has; `kern_migration` by default. */
  tableName?: string
  /** PostgreSQL schemas that the search path of the migrations lists after the target schema, such as the schema of extensions. */
  searchPath?: readonly string[]
  /** Baseline that replaces the first migrations of the history, such as after squashing them. */
  baseline?: MigrationBaselineOptions
}

/** Baseline of a history. */
export interface MigrationBaseline {
  /** Keys of the migrations that the baseline replaces, in order; the history may keep the modules of the last of them. */
  readonly replaces: readonly string[]
  /**
   * Returns the steps of the baseline, loading its module when the history has its loader.
   *
   * It rejects with a `MigrationError` without a key when the module fails to load, does not export a migration, or has changes outside a transaction.
   */
  load(): Promise<readonly MigrationStep[]>
}

/** History of migrations: their keys in order, and how a target keeps the applied ones. */
export interface MigrationHistory {
  /** Keys of the migrations that the history can load, in the order of their numbers; with a baseline, they lack the replaced migrations whose modules the history does not keep. */
  readonly keys: readonly string[]
  /** Name of the table of versions in the target schema. */
  readonly tableName: string
  /** PostgreSQL schemas that the search path of the migrations lists after the target schema. */
  readonly searchPath: readonly string[]
  /** Baseline of the history, if it has one. */
  readonly baseline?: MigrationBaseline
  /**
   * Returns the steps of the migration of `key`, loading its module when the history has its loader.
   *
   * It rejects with a `MigrationError` when the module fails to load or does not export a migration.
   */
  load(key: string): Promise<readonly MigrationStep[]>
}

/** Migration of a history. */
interface HistoryEntry {
  readonly key: string
  readonly number: bigint
  readonly load: () => Promise<readonly MigrationStep[]>
}

// A key is a file name without directories and extension, so it has neither `/` nor a dot.
const keyPattern = /^(\d+)_[^./\s]+$/

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
 * Returns the keys of `history` in order with the keys that its baseline replaces, also those whose modules the history does not keep.
 *
 * These are the keys that a target records, and that calls compare with its applied keys.
 */
export function listHistoryKeys(history: MigrationHistory): readonly string[] {
  const { baseline, keys } = history
  if (baseline === undefined) {
    return keys
  }
  const all = [...baseline.replaces]
  for (let index = countReplacedModules(history, baseline); index < keys.length; index++) {
    all.push(keys[index]!)
  }
  return all
}

/** Returns the keys of `history` after the last key that its baseline replaces, or all of its keys without a baseline. */
export function listKeysAfterBaseline(history: MigrationHistory): readonly string[] {
  const { baseline, keys } = history
  return baseline === undefined ? keys : keys.slice(countReplacedModules(history, baseline))
}

/**
 * Returns the number of the keys of `history` that `baseline` replaces.
 *
 * A history keeps the modules of the last replaced migrations without a gap, so they are its first keys and the last keys of `replaces`.
 */
export function countReplacedModules(
  history: MigrationHistory,
  baseline: MigrationBaseline,
): number {
  const firstKey = history.keys[0]
  const index = firstKey === undefined ? -1 : baseline.replaces.indexOf(firstKey)
  return index === -1 ? 0 : baseline.replaces.length - index
}

/**
 * Defines a history of migrations from the loaders of their modules or the migrations themselves, by key or by path as `import.meta.glob` returns them.
 *
 * A key is the file name without directories and extension, of the form `<number>_<name>`, such as `0001_create_form`, and the numbers order the history.
 * It rejects a key of another form, a path of a file of migration tests, two keys of one number, such as migrations of two branches that took one number, and a value that is neither a loader nor a migration.
 *
 * `baseline` of the options gives a migration without a key that replaces the first migrations of the history, with their keys in `replaces`: a target without applied migrations runs it instead of them.
 * It rejects `replaces` that is empty, has a key of another form, or is out of order, a migration before the last replaced one that `replaces` lacks, modules of replaced migrations other than the last ones, and a baseline that is neither a loader nor a migration or has changes outside a transaction.
 */
export function defineMigrations(
  migrations: Readonly<Record<string, MigrationLoader | Migration>>,
  options: MigrationHistoryOptions = {},
): MigrationHistory {
  const entries: HistoryEntry[] = []
  for (const [name, value] of Object.entries(migrations)) {
    const isPath = name.includes("/")
    // `import.meta.glob` of the migration modules also returns the files of migration tests beside them, unless its patterns exclude them.
    if (isPath && getMigrationTestKey(name.slice(name.lastIndexOf("/") + 1)) !== undefined) {
      throw new Error(
        `${name} is a file of migration tests rather than a migration: exclude migration tests from the modules of the history, such as with "!./migrations/*.migration-test.ts" in the patterns of import.meta.glob`,
      )
    }
    const key = isPath ? getFileKey(name) : name
    const number = getMigrationNumber(key)
    if (number === undefined) {
      throw new Error(
        `Migration ${name} must be named <number>_<name>, such as 0001_create_form, without dots`,
      )
    }
    entries.push({ key, number, load: toStepsLoader(key, value) })
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
  const baseline =
    options.baseline === undefined ? undefined : toBaseline(options.baseline, entries)

  return {
    keys: Object.freeze(entries.map(entry => entry.key)),
    tableName: options.tableName ?? "kern_migration",
    searchPath: Object.freeze([...(options.searchPath ?? [])]),
    ...(baseline && { baseline }),
    async load(key) {
      const entry = byKey.get(key)
      if (entry === undefined) {
        throw new Error(`The history has no migration ${key}`)
      }
      return await entry.load()
    },
  }
}

/**
 * Returns the baseline of a history of `entries`, which are in the order of their numbers, checking its options.
 *
 * It rejects `replaces` that is empty, has a key of another form, or is out of order; an entry up to the last replaced key that `replaces` lacks, which no target that the baseline built would apply; and entries of replaced keys other than the last ones, since calls apply and roll back migrations in order.
 */
function toBaseline(
  options: MigrationBaselineOptions,
  entries: readonly HistoryEntry[],
): MigrationBaseline {
  const replaces: unknown = options?.replaces
  if (!Array.isArray(replaces) || replaces.length === 0) {
    throw new Error(
      "The baseline of a history requires replaces: the keys of the migrations that it replaces, in order",
    )
  }
  let lastNumber: bigint | undefined
  for (let index = 0; index < replaces.length; index++) {
    const key: unknown = replaces[index]
    const number = typeof key === "string" ? getMigrationNumber(key) : undefined
    if (number === undefined) {
      throw new Error(
        `Replaced migration ${String(key)} must be named <number>_<name>, such as 0001_create_form, without dots or slashes`,
      )
    }
    if (lastNumber !== undefined && number <= lastNumber) {
      throw new Error(
        `Replaced migration ${String(key)} must follow ${String(replaces[index - 1])}: list the migrations that the baseline replaces in the order of their numbers, each once`,
      )
    }
    lastNumber = number
  }
  const keys = Object.freeze([...(replaces as string[])])
  const lastKey = keys.at(-1)!
  // Entries up to the last replaced key, which are the first entries.
  let kept = 0
  while (kept < entries.length && entries[kept]!.number <= lastNumber!) {
    kept++
  }
  for (let index = 0; index < kept; index++) {
    const { key } = entries[index]!
    if (!keys.includes(key)) {
      throw new Error(
        `Migration ${key} does not follow ${lastKey}, the last migration that the baseline replaces, and replaces lacks it: give a new migration a number after that migration; if the baseline already includes the changes of this migration, add it to replaces`,
      )
    }
  }
  // The kept entries are the last replaced keys, compared from the last one, so that the error names the first gap.
  for (let offset = 1; offset <= kept; offset++) {
    const { key } = entries[kept - offset]!
    const replaced = keys[keys.length - offset]!
    if (replaced !== key) {
      throw new Error(
        `The history has replaced migration ${key} without ${replaced}, which follows it: keep the modules of the last migrations that the baseline replaces without a gap, or of none`,
      )
    }
  }
  return { replaces: keys, load: toStepsLoader(undefined, options.migration) }
}

/**
 * Returns the function that gives the steps of migration `key`, or of the baseline of a history without `key`: it checks a migration given as a value at once, and loads the module of a loader only when the function is called.
 *
 * It rejects a value that is neither a loader nor a migration.
 */
function toStepsLoader(
  key: string | undefined,
  value: MigrationLoader | Migration,
): () => Promise<readonly MigrationStep[]> {
  if (typeof value === "function") {
    return () => loadModule(key, value)
  }
  const steps = toMigrationSteps(
    key,
    value,
    "be the loader of its module, a step, or a non-empty array of steps",
  )
  return async () => steps
}

/** Loads the module of migration `key`, or of the baseline of a history without `key`, with `loader` and returns the steps of its default export. */
async function loadModule(
  key: string | undefined,
  loader: MigrationLoader,
): Promise<readonly MigrationStep[]> {
  let module: unknown
  try {
    module = await loader()
  } catch (error) {
    throw new MigrationError(`Cannot load ${nameMigration(key)}: ${getErrorMessage(error)}`, {
      key,
      cause: error,
    })
  }
  return toMigrationSteps(
    key,
    typeof module === "object" && module !== null
      ? (module as { default?: unknown }).default
      : undefined,
    "export a step or a non-empty array of steps as its default export",
  )
}

/** Returns the key of a migration module at `path`: its file name without directories and extension. */
function getFileKey(path: string): string {
  const fileName = path.slice(path.lastIndexOf("/") + 1)
  const dot = fileName.lastIndexOf(".")
  return dot > 0 ? fileName.slice(0, dot) : fileName
}
