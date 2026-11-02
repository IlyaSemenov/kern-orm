import type { MigrationDirection } from "./error"
import { getErrorMessage, MigrationError } from "./error"
import type { MigrationHistory } from "./history"
import { getMigrationNumber } from "./history"
import type { MigrationDatabase, MigrationStep } from "./migration"
import type {
  MigrationTarget,
  MigrationTargetOptions,
  ResolvedTarget,
  TargetVersions,
} from "./target"
import {
  createVersionsTable,
  deleteVersion,
  insertVersion,
  lockTarget,
  openTarget,
  readVersions,
} from "./target"

/** Options of `rollback`. */
export interface RollbackOptions extends MigrationTargetOptions {
  /** Number of the last applied migrations to roll back, or `"all"`; one by default. */
  count?: number | "all"
}

/** Options of `redo`. */
export interface RedoOptions extends MigrationTargetOptions {
  /** Number of the last applied migrations to roll back and apply again; one by default. */
  count?: number
}

/** Migrations of a history as a target has applied them. */
export interface MigrationStatus {
  /** Keys of the applied migrations of the history, in order. */
  readonly applied: readonly string[]
  /** Keys of the migrations of the history that the target has not applied, in order. */
  readonly pending: readonly string[]
  /** Applied keys that the history lacks, such as of migrations that a newer version of the application has applied. */
  readonly unknown: readonly string[]
}

/**
 * Applies the pending migrations of `history` to `target` in one transaction and resolves to their keys.
 *
 * Inside a transaction, it runs in a nested transaction, so that the migrations commit or roll back with the enclosing one.
 * A target that is up to date costs two statements outside a transaction; otherwise, it locks the target, so that processes that migrate it at once apply each migration once.
 * It rejects when the target has applied a migration that the history lacks before its last migration, or a migration after a pending one; applied migrations after the last one, such as of a newer version of the application, are allowed.
 */
export async function migrate(
  target: MigrationTarget,
  history: MigrationHistory,
  options: MigrationTargetOptions = {},
): Promise<string[]> {
  const opened = await openTarget(target, history, options)
  if (getPendingKeys(history, opened.target, opened.versions).length === 0) {
    return []
  }
  return await runLocked(opened.target, async () => {
    const versions = await readVersions(opened.target)
    const pending = getPendingKeys(history, opened.target, versions)
    const migrations = await loadMigrations(history, pending)
    await createVersionsTable(opened.target, versions)
    for (const { key, steps } of migrations) {
      await runSteps(opened.target, key, steps, "up")
      await insertVersion(opened.target, key)
    }
    return pending
  })
}

/**
 * Rolls back the last applied migrations of `target` in one transaction, one by default, and resolves to their keys in the order of rolling back.
 *
 * It rejects when the target has applied a migration that the history lacks, since it cannot roll it back.
 */
export async function rollback(
  target: MigrationTarget,
  history: MigrationHistory,
  options: RollbackOptions = {},
): Promise<string[]> {
  const count = getCount(options.count, true)
  const opened = await openTarget(target, history, options)
  checkAppliedKeys(history, opened.target, opened.versions, "roll back the migrations of")
  if (opened.versions.applied.length === 0) {
    return []
  }
  return await runLocked(opened.target, async () => {
    const versions = await readVersions(opened.target)
    checkAppliedKeys(history, opened.target, versions, "roll back the migrations of")
    const keys = getLastKeys(versions, count).reverse()
    for (const { key, steps } of await loadMigrations(history, keys)) {
      await runSteps(opened.target, key, steps, "down")
      await deleteVersion(opened.target, key)
    }
    return keys
  })
}

/**
 * Rolls back the last applied migrations of `target` and applies them again in one transaction, one by default, and resolves to their keys in order.
 *
 * It rejects when the target has applied a migration that the history lacks, since it cannot roll it back.
 */
export async function redo(
  target: MigrationTarget,
  history: MigrationHistory,
  options: RedoOptions = {},
): Promise<string[]> {
  const count = getCount(options.count, false)
  const opened = await openTarget(target, history, options)
  checkAppliedKeys(history, opened.target, opened.versions, "redo the migrations of")
  if (opened.versions.applied.length === 0) {
    return []
  }
  return await runLocked(opened.target, async () => {
    const versions = await readVersions(opened.target)
    checkAppliedKeys(history, opened.target, versions, "redo the migrations of")
    const keys = getLastKeys(versions, count)
    const migrations = await loadMigrations(history, keys)
    for (let index = migrations.length - 1; index >= 0; index--) {
      const { key, steps } = migrations[index]!
      await runSteps(opened.target, key, steps, "down")
      await deleteVersion(opened.target, key)
    }
    for (const { key, steps } of migrations) {
      await runSteps(opened.target, key, steps, "up")
      await insertVersion(opened.target, key)
    }
    return keys
  })
}

/** Lists the applied and the pending migrations of `history` on `target`, and the applied migrations that the history lacks. */
export async function getMigrationStatus(
  target: MigrationTarget,
  history: MigrationHistory,
  options: MigrationTargetOptions = {},
): Promise<MigrationStatus> {
  const { versions } = await openTarget(target, history, options)
  const known = new Set(history.keys)
  const applied = new Set(versions.applied)
  return {
    applied: versions.applied.filter(key => known.has(key)),
    pending: history.keys.filter(key => !applied.has(key)),
    unknown: versions.applied.filter(key => !known.has(key)),
  }
}

/** Migration that a call loaded. */
interface LoadedMigration {
  readonly key: string
  readonly steps: readonly MigrationStep[]
}

/**
 * Returns the keys of `history` that `target` has not applied, in order.
 *
 * It rejects an applied key that the history lacks unless it follows the last key of the history, and a pending key before an applied one.
 */
function getPendingKeys(
  history: MigrationHistory,
  target: ResolvedTarget,
  versions: TargetVersions,
): string[] {
  const known = new Set(history.keys)
  const lastKey = history.keys.at(-1)
  const lastNumber = lastKey === undefined ? undefined : getMigrationNumber(lastKey)!
  let lastApplied: { key: string; number: bigint } | undefined
  for (const key of versions.applied) {
    const number = getMigrationNumber(key)
    if (
      number === undefined ||
      (!known.has(key) && lastNumber !== undefined && number <= lastNumber)
    ) {
      throw new Error(
        `Cannot migrate schema "${target.schemaName}": migration ${key} is applied, but the history lacks it`,
      )
    }
    lastApplied = { key, number }
  }
  const applied = new Set(versions.applied)
  const pending = history.keys.filter(key => !applied.has(key))
  const firstPending = pending[0]
  if (
    firstPending !== undefined &&
    lastApplied !== undefined &&
    getMigrationNumber(firstPending)! < lastApplied.number
  ) {
    throw new Error(
      `Cannot migrate schema "${target.schemaName}": migration ${firstPending} is pending, but the later migration ${lastApplied.key} is applied`,
    )
  }
  return pending
}

/** Rejects applied keys that the history lacks, since `action` cannot run their `down`. */
function checkAppliedKeys(
  history: MigrationHistory,
  target: ResolvedTarget,
  versions: TargetVersions,
  action: string,
): void {
  const known = new Set(history.keys)
  const unknown = versions.applied.find(key => !known.has(key))
  if (unknown !== undefined) {
    throw new Error(
      `Cannot ${action} schema "${target.schemaName}": migration ${unknown} is applied, but the history lacks it`,
    )
  }
}

/** Runs `callback` in a transaction that locks `target`, with the search path of its migrations. */
function runLocked<T>(target: ResolvedTarget, callback: () => Promise<T>): Promise<T> {
  return target.database.transaction(
    async () => {
      await lockTarget(target)
      return await callback()
    },
    { searchPath: target.searchPath },
  )
}

/** Loads the migrations of `keys` in order, before any of them runs, so that a module that fails to load changes nothing. */
async function loadMigrations(
  history: MigrationHistory,
  keys: readonly string[],
): Promise<LoadedMigration[]> {
  const migrations: LoadedMigration[] = []
  for (const key of keys) {
    migrations.push({ key, steps: await history.load(key) })
  }
  return migrations
}

/** Runs the changes of `direction` of the steps of migration `key`: `up` in the order of the steps, and `down` in reverse order. */
async function runSteps(
  target: ResolvedTarget,
  key: string,
  steps: readonly MigrationStep[],
  direction: MigrationDirection,
): Promise<void> {
  const { database } = target
  const migrationDatabase: MigrationDatabase = {
    query: database.query.bind(database),
    script: database.script.bind(database),
  }
  for (let position = 0; position < steps.length; position++) {
    const index = direction === "up" ? position : steps.length - 1 - position
    const change = steps[index]![direction]
    if (change === undefined) {
      continue
    }
    try {
      await (typeof change === "string" ? database.script(change) : change(migrationDatabase))
    } catch (error) {
      throw new MigrationError(
        `Migration ${key} failed in ${direction} of step ${index + 1}: ${getErrorMessage(error)}`,
        { key, step: index + 1, direction, cause: error },
      )
    }
  }
}

/** Returns the last `count` applied keys in order. */
function getLastKeys(versions: TargetVersions, count: number): string[] {
  return versions.applied.slice(Math.max(versions.applied.length - count, 0))
}

/** Returns the number of migrations of a `count` option, rejecting one that is not a positive integer, or `"all"` when `allowsAll` is set. */
function getCount(count: number | "all" | undefined, allowsAll: boolean): number {
  if (count === undefined) {
    return 1
  }
  if (count === "all" && allowsAll) {
    return Number.POSITIVE_INFINITY
  }
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 1) {
    throw new Error(
      `count must be a positive integer${allowsAll ? ' or "all"' : ""}, not ${String(count)}`,
    )
  }
  return count
}
