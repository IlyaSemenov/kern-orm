import type { TransactionOptions } from "kern-db"

import type { MigrationDirection } from "./error"
import type { MigrationHistory } from "./history"
import { getMigrationNumber } from "./history"
import type { MigrationStep } from "./migration"
import {
  getOutsideTransactionChange,
  runMigrationSteps,
  runOutsideTransaction,
  toMigrationDatabase,
} from "./migration"
import type {
  MigrationTarget,
  MigrationTargetOptions,
  OpenedTarget,
  ResolvedTarget,
  TargetVersions,
} from "./target"
import {
  checkTargetArguments,
  createVersionsTable,
  deleteVersion,
  insertVersion,
  openTarget,
  readVersions,
} from "./target"

/** Options of `migrate`. */
export interface MigrateOptions extends MigrationTargetOptions {
  /** Number of the first pending migrations to apply; all by default. */
  count?: number
}

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
  /** PostgreSQL schema of the target that the call resolved, such as `current_schema()` of a `Database`. */
  readonly schemaName: string
  /** Keys of the applied migrations of the history, in order. */
  readonly applied: readonly string[]
  /** Keys of the migrations of the history that the target has not applied, in order. */
  readonly pending: readonly string[]
  /** Applied keys that the history lacks, such as of migrations that a newer version of the application has applied. */
  readonly unknown: readonly string[]
}

/**
 * Applies the pending migrations of `history` to `target`, or the first `count` of them, and resolves to their keys.
 *
 * It applies them in one transaction, unless a migration runs outside a transaction: that migration runs alone, after the migrations before it commit, and the migrations after it run in a transaction of their own.
 * Inside a transaction, it runs in a nested transaction, so that the migrations commit or roll back with the enclosing one, and every migration runs in it.
 * A target that is up to date costs two statements outside a transaction; otherwise, it locks the target, so that processes that migrate it at once apply each migration once.
 * It rejects when the target has applied a migration that the history lacks before its last migration, or a migration after a pending one; applied migrations after the last one, such as of a newer version of the application, are allowed.
 * In a transaction at `repeatable read` or `serializable`, it rejects when it has migrations to apply, before it locks the target, since the snapshot of the transaction misses the migrations that another process applies meanwhile.
 */
export async function migrate(
  target: MigrationTarget,
  history: MigrationHistory,
  options: MigrateOptions = {},
): Promise<string[]> {
  checkTargetArguments(target, options)
  const count =
    options.count === undefined ? Number.POSITIVE_INFINITY : getCount(options.count, false)
  const opened = await openTarget(target, history, options)
  if (getPendingKeys(history, opened.target, opened.versions).length === 0) {
    return []
  }
  return await runLocked(opened, history, "migrate", versions => {
    const keys = getPendingKeys(history, opened.target, versions).slice(0, count)
    return { keys, runs: keys.map(key => ({ key, direction: "up" })) }
  })
}

/**
 * Rolls back the last applied migrations of `target`, one by default, and resolves to their keys in the order of rolling back.
 *
 * It rolls them back in one transaction, unless a migration runs outside a transaction, as `migrate` applies them.
 * It rejects when the target has applied a migration that the history lacks, since it cannot roll it back.
 * In a transaction at `repeatable read` or `serializable`, it rejects when the target has applied migrations, before it locks the target.
 */
export async function rollback(
  target: MigrationTarget,
  history: MigrationHistory,
  options: RollbackOptions = {},
): Promise<string[]> {
  checkTargetArguments(target, options)
  const count = getCount(options.count, true)
  const opened = await openTarget(target, history, options)
  checkAppliedKeys(history, opened.target, opened.versions, "roll back the migrations of")
  if (opened.versions.applied.length === 0) {
    return []
  }
  return await runLocked(opened, history, "roll back the migrations of", versions => {
    checkAppliedKeys(history, opened.target, versions, "roll back the migrations of")
    const keys = getLastKeys(versions, count).reverse()
    return { keys, runs: keys.map(key => ({ key, direction: "down" })) }
  })
}

/**
 * Rolls back the last applied migrations of `target` and applies them again, one by default, and resolves to their keys in order.
 *
 * It runs them in one transaction, unless a migration runs outside a transaction, as `migrate` applies them.
 * It rejects when the target has applied a migration that the history lacks, since it cannot roll it back.
 * In a transaction at `repeatable read` or `serializable`, it rejects when the target has applied migrations, before it locks the target.
 */
export async function redo(
  target: MigrationTarget,
  history: MigrationHistory,
  options: RedoOptions = {},
): Promise<string[]> {
  checkTargetArguments(target, options)
  const count = getCount(options.count, false)
  const opened = await openTarget(target, history, options)
  checkAppliedKeys(history, opened.target, opened.versions, "redo the migrations of")
  if (opened.versions.applied.length === 0) {
    return []
  }
  return await runLocked(opened, history, "redo the migrations of", versions => {
    checkAppliedKeys(history, opened.target, versions, "redo the migrations of")
    const keys = getLastKeys(versions, count)
    const runs: PlannedRun[] = []
    for (let index = keys.length - 1; index >= 0; index--) {
      runs.push({ key: keys[index]!, direction: "down" })
    }
    for (const key of keys) {
      runs.push({ key, direction: "up" })
    }
    return { keys, runs }
  })
}

/** Lists the applied and the pending migrations of `history` on `target`, and the applied migrations that the history lacks. */
export async function getMigrationStatus(
  target: MigrationTarget,
  history: MigrationHistory,
  options: MigrationTargetOptions = {},
): Promise<MigrationStatus> {
  checkTargetArguments(target, options)
  const opened = await openTarget(target, history, options)
  const { versions } = opened
  const known = new Set(history.keys)
  const applied = new Set(versions.applied)
  return {
    schemaName: opened.target.schemaName,
    applied: versions.applied.filter(key => known.has(key)),
    pending: history.keys.filter(key => !applied.has(key)),
    unknown: versions.applied.filter(key => !known.has(key)),
  }
}

/** Migration that a call runs in one direction. */
interface PlannedRun {
  readonly key: string
  readonly direction: MigrationDirection
}

/** Migration that a call runs in one direction, with its loaded steps. */
interface MigrationRun extends PlannedRun {
  readonly steps: readonly MigrationStep[]
}

/** Migrations that a call runs in order under the lock of its target, and the keys that it resolves to. */
interface CallPlan {
  readonly keys: string[]
  readonly runs: readonly PlannedRun[]
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

/**
 * Locks the target of `opened`, reads its versions again, loads the migrations that `plan` chooses from them, runs them, and resolves to the keys of the plan.
 *
 * The lock belongs to the qualified name of the table of versions, so that different targets and histories of one target migrate at once.
 * In a transaction block, such as of an enclosing transaction or a test, it runs every migration in a nested transaction that locks the target, with the search path of the migrations.
 * Outside one, it runs them in a session with that search path, which polls for the lock, since a transaction that waits for it would keep a snapshot, which `CREATE INDEX CONCURRENTLY` of the session that holds the lock waits for.
 * It decides which migrations run outside a transaction only from the steps that it loads under the lock, since another process may change the applied migrations before the lock.
 * `action` names the call in its errors, such as `roll back the migrations of`.
 */
async function runLocked(
  opened: OpenedTarget,
  history: MigrationHistory,
  action: string,
  plan: (versions: TargetVersions) => CallPlan,
): Promise<string[]> {
  const { target } = opened
  const { database } = target
  const inTransaction = database.isInTransactionBlock()
  if (inTransaction && snapshotIsolationLevels.has(opened.isolation)) {
    throw new Error(
      `Cannot ${action} schema "${target.schemaName}" in a transaction at isolation level ${opened.isolation}, whose snapshot misses the migrations that another process applies or rolls back meanwhile; run the call outside a transaction or in a transaction at read committed`,
    )
  }
  const run = async () => {
    await (inTransaction ? database.lock(target.table) : database.pollLock(target.table))
    const versions = await readVersions(target)
    const { keys, runs } = plan(versions)
    const loaded = await loadMigrations(history, runs)
    await (inTransaction
      ? runInTransaction(target, versions, loaded)
      : runInSession(target, versions, loaded))
    return keys
  }
  const options = { searchPath: target.searchPath }
  return inTransaction
    ? await database.transaction(run, options)
    : await database.session(run, options)
}

/**
 * Isolation levels whose transaction reads from one snapshot, which misses what other transactions commit after it.
 *
 * A call in a transaction block reads the versions under the lock from that snapshot, so it would apply again the migrations that another process has applied meanwhile, or roll back others than the last ones.
 */
const snapshotIsolationLevels: ReadonlySet<string> = new Set(["repeatable read", "serializable"])

/**
 * Options of the transactions of a call in a session, whatever the default isolation level of the database.
 *
 * Creating the target schema and `createExtension` check again under a lock what another transaction has committed meanwhile, which a transaction at `read committed` sees, since each statement takes a new snapshot there.
 */
const sessionTransactionOptions: TransactionOptions = { isolation: "read committed" }

/** Runs `runs` in order in the transaction of a call, creating the schema and the table of versions that `versions` lacks before them. */
async function runInTransaction(
  target: ResolvedTarget,
  versions: TargetVersions,
  runs: readonly MigrationRun[],
): Promise<void> {
  if (runs.length === 0) {
    return
  }
  await createVersionsTable(target, versions)
  await runMigrations(target, runs)
}

/**
 * Runs `runs` in order in the session of a call: a migration that has a change of its direction outside a transaction runs it alone and is recorded after it in a statement of its own, and each sequence of other migrations between such migrations runs in one transaction.
 *
 * Before a first migration outside a transaction, it creates the schema and the table of versions in a transaction of their own.
 *
 * The migrations before a failure stay committed, and a migration whose change fails outside a transaction keeps its record, so that `migrate` runs its `up` again, and `rollback` its `down`.
 */
async function runInSession(
  target: ResolvedTarget,
  versions: TargetVersions,
  runs: readonly MigrationRun[],
): Promise<void> {
  let start = 0
  while (start < runs.length) {
    const run = runs[start]!
    const change = getOutsideTransactionChange(run.steps, run.direction)
    if (change !== undefined) {
      if (start === 0) {
        await target.database.transaction(
          () => createVersionsTable(target, versions),
          sessionTransactionOptions,
        )
      }
      await runOutsideTransaction(
        toMigrationDatabase(target.database),
        run.key,
        run.direction,
        change,
      )
      await recordRun(target, run)
      start++
      continue
    }
    let end = start + 1
    while (
      end < runs.length &&
      getOutsideTransactionChange(runs[end]!.steps, runs[end]!.direction) === undefined
    ) {
      end++
    }
    const batch = runs.slice(start, end)
    // The first transaction creates the schema and the table of versions, so that a call that fails in it changes nothing.
    const first = start === 0
    await target.database.transaction(async () => {
      if (first) {
        await createVersionsTable(target, versions)
      }
      await runMigrations(target, batch)
    }, sessionTransactionOptions)
    start = end
  }
}

/** Runs `runs` in order in a transaction with the changes of `up` and `down` of their steps, recording each migration after it runs. */
async function runMigrations(target: ResolvedTarget, runs: readonly MigrationRun[]): Promise<void> {
  const database = toMigrationDatabase(target.database)
  for (const run of runs) {
    await runMigrationSteps(database, run.key, run.steps, run.direction)
    await recordRun(target, run)
  }
}

/** Records migration `run` as applied after `up`, and as not applied after `down`. */
async function recordRun(target: ResolvedTarget, run: MigrationRun): Promise<void> {
  await (run.direction === "up" ? insertVersion(target, run.key) : deleteVersion(target, run.key))
}

/** Loads the migrations of `runs` in order, each once, before any of them runs, so that a module that fails to load changes nothing. */
async function loadMigrations(
  history: MigrationHistory,
  runs: readonly PlannedRun[],
): Promise<MigrationRun[]> {
  const steps = new Map<string, readonly MigrationStep[]>()
  const loaded: MigrationRun[] = []
  for (const { key, direction } of runs) {
    let migration = steps.get(key)
    if (migration === undefined) {
      migration = await history.load(key)
      steps.set(key, migration)
    }
    loaded.push({ key, direction, steps: migration })
  }
  return loaded
}

/** Returns the last `count` applied keys in order. */
function getLastKeys(versions: TargetVersions, count: number): string[] {
  return versions.applied.slice(Math.max(versions.applied.length - count, 0))
}

/** Returns the number of migrations of a `count` option, 1 without it, accepting a positive integer, or `"all"` when `allowsAll` is set; throws `TypeError` for another value. */
function getCount(count: number | "all" | undefined, allowsAll: boolean): number {
  if (count === undefined) {
    return 1
  }
  if (count === "all" && allowsAll) {
    return Number.POSITIVE_INFINITY
  }
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 1) {
    throw new TypeError(
      `count must be a positive integer${allowsAll ? ' or "all"' : ""}, not ${String(count)}`,
    )
  }
  return count
}
