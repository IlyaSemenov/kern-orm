import type { TransactionOptions } from "kern-db"

import type { MigrationDirection } from "./error"
import type { MigrationHistory } from "./history"
import { countReplacedModules, getMigrationNumber, listHistoryKeys } from "./history"
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
  deleteVersions,
  insertVersions,
  openTarget,
  readVersions,
} from "./target"

/** Options of `migrate`. */
export interface MigrateOptions extends MigrationTargetOptions {
  /** Number of the first pending migrations to apply, of which a baseline is one; all by default. */
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

/** State of a target against a history: the keys that its table of versions has, and those that it lacks. */
export interface MigrationStatus {
  /** PostgreSQL schema of the target that the call resolved, such as `current_schema()` of a `Database`. */
  readonly schemaName: string
  /** Keys of the history that the target has, in order, with the keys that a baseline replaces, also those without modules, and the keys of the target before the first of them. */
  readonly applied: readonly string[]
  /** Keys of the history that the target lacks, in order: on a target without keys, also the keys that a baseline replaces. */
  readonly pending: readonly string[]
  /** Other keys of the target, which the history lacks, such as of migrations that a newer version of the application has applied. */
  readonly unknown: readonly string[]
}

/**
 * Applies the pending migrations of `history` to `target`, or the first `count` of them, and resolves to the keys that it recorded.
 *
 * It applies them in one transaction, unless a migration runs outside a transaction: that migration runs alone, after the migrations before it commit, and the migrations after it run in a transaction of their own.
 * Inside a transaction, it runs in a nested transaction, so that the migrations commit or roll back with the enclosing one, and every migration runs in it.
 * A target that is up to date costs two statements outside a transaction; otherwise, it locks the target, so that processes that migrate it at once apply each migration once.
 * It rejects when the target has applied a migration that the history lacks before its last migration, or a migration after a pending one; applied migrations after the last one, such as of a newer version of the application, are allowed.
 * In a transaction at `repeatable read` or `serializable`, it rejects when it has migrations to apply, before it locks the target, since the snapshot of the transaction misses the migrations that another process applies meanwhile.
 *
 * With a baseline, a target without applied migrations runs it and records the keys that it replaces, and a target that has the last of them needs nothing of it.
 * A target that has applied migrations but lacks replaced ones applies them when the history keeps their modules, and rejects otherwise.
 * Applied migrations before the first replaced one are not checked.
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
  return await runLocked(opened, history, "migrate", versions =>
    planMigrate(history, opened.target, versions, count),
  )
}

/**
 * Rolls back the last applied migrations of `target`, one by default, and resolves to their keys in the order of rolling back.
 *
 * It rolls them back in one transaction, unless a migration runs outside a transaction, as `migrate` applies them.
 * It rejects when the target has applied a migration that the history lacks, since it cannot roll it back.
 * In a transaction at `repeatable read` or `serializable`, it rejects when the target has applied migrations, before it locks the target.
 *
 * With a baseline, a call that rolls back every migration rolls back the replaced ones together with `down` of the baseline, which requires all of them applied.
 * Another call rolls back a replaced migration with its own `down`, and rejects before it changes anything when it reaches one whose module the history lacks.
 */
export async function rollback(
  target: MigrationTarget,
  history: MigrationHistory,
  options: RollbackOptions = {},
): Promise<string[]> {
  checkTargetArguments(target, options)
  const count = getCount(options.count, true)
  const opened = await openTarget(target, history, options)
  const action = "roll back the migrations of"
  return await runLocked(opened, history, action, versions =>
    toCallPlan(planUndo(history, opened.target, versions, count, action)),
  )
}

/**
 * Rolls back the last applied migrations of `target` and applies them again, one by default, and resolves to their keys in order.
 *
 * It runs them in one transaction, unless a migration runs outside a transaction, as `migrate` applies them.
 * It rejects when the target has applied a migration that the history lacks, since it cannot roll it back.
 * In a transaction at `repeatable read` or `serializable`, it rejects when the target has applied migrations, before it locks the target.
 *
 * With a baseline, it rolls back the migrations as `rollback` does, and a call that rolls back every migration applies the baseline again.
 */
export async function redo(
  target: MigrationTarget,
  history: MigrationHistory,
  options: RedoOptions = {},
): Promise<string[]> {
  checkTargetArguments(target, options)
  const count = getCount(options.count, false)
  const opened = await openTarget(target, history, options)
  const action = "redo the migrations of"
  return await runLocked(opened, history, action, versions => {
    const undone = planUndo(history, opened.target, versions, count, action)
    const applied: PlannedRun[] = []
    for (let index = undone.length - 1; index >= 0; index--) {
      const { key, keys } = undone[index]!
      // The baseline records the keys that it replaces, while its `down` also removed the keys before them.
      applied.push({
        key,
        direction: "up",
        keys: key === undefined ? history.baseline!.replaces : keys,
      })
    }
    return { keys: toCallPlan(applied).keys, runs: [...undone, ...applied] }
  })
}

/**
 * Gives the state of `target` against `history`: the keys of the history that its table of versions has and lacks, and its keys that the history lacks.
 *
 * With a baseline, the keys that it replaces are keys of the history, also those without modules, and the keys of the target before the first of them count as applied.
 */
export async function getMigrationStatus(
  target: MigrationTarget,
  history: MigrationHistory,
  options: MigrationTargetOptions = {},
): Promise<MigrationStatus> {
  checkTargetArguments(target, options)
  const opened = await openTarget(target, history, options)
  const { versions } = opened
  const keys = listHistoryKeys(history)
  const isUnknown = createUnknownKeyCheck(history, keys)
  const applied = new Set(versions.applied)
  return {
    schemaName: opened.target.schemaName,
    applied: versions.applied.filter(key => !isUnknown(key)),
    pending: keys.filter(key => !applied.has(key)),
    unknown: versions.applied.filter(isUnknown),
  }
}

/** Migration that a call runs in one direction, or the baseline of the history. */
interface PlannedRun {
  /** Key of the migration, or `undefined` for the baseline. */
  readonly key: string | undefined
  readonly direction: MigrationDirection
  /** Keys that the run records as applied after `up`, and as not applied after `down`: the key of the migration, or the keys that the baseline stands for. */
  readonly keys: readonly string[]
}

/** Run of a call with its loaded steps. */
interface MigrationRun extends PlannedRun {
  readonly steps: readonly MigrationStep[]
}

/** Runs of a call in order under the lock of its target, and the keys that it resolves to. */
interface CallPlan {
  readonly keys: string[]
  readonly runs: readonly PlannedRun[]
}

/** Returns the plan of `runs` that resolves to the keys that they record, in their order. */
function toCallPlan(runs: readonly PlannedRun[]): CallPlan {
  const keys: string[] = []
  for (const run of runs) {
    for (const key of run.keys) {
      keys.push(key)
    }
  }
  return { keys, runs }
}

/**
 * Returns the function that checks whether `history`, whose keys with those of its baseline are `keys`, lacks a key of a target.
 *
 * It lacks a key of another form, and a key that is not among `keys`, except one before the first key that the baseline replaces: a target that the baseline built lacks such keys, so no call checks them.
 */
function createUnknownKeyCheck(
  history: MigrationHistory,
  keys: readonly string[],
): (key: string) => boolean {
  const known = new Set(keys)
  const firstReplaced = history.baseline?.replaces[0]
  const firstNumber = firstReplaced === undefined ? undefined : getMigrationNumber(firstReplaced)!
  return key => {
    if (known.has(key)) {
      return false
    }
    const number = getMigrationNumber(key)
    return number === undefined || firstNumber === undefined || number >= firstNumber
  }
}

/**
 * Returns the keys of `history`, with those that its baseline replaces, that `target` has not applied, in order.
 *
 * It rejects an applied key that the history lacks unless it follows the last key of the history, and a pending key before an applied one.
 */
function getPendingKeys(
  history: MigrationHistory,
  target: ResolvedTarget,
  versions: TargetVersions,
): string[] {
  const keys = listHistoryKeys(history)
  const isUnknown = createUnknownKeyCheck(history, keys)
  const lastKey = keys.at(-1)
  const lastNumber = lastKey === undefined ? undefined : getMigrationNumber(lastKey)!
  let lastApplied: { key: string; number: bigint } | undefined
  for (const key of versions.applied) {
    const number = getMigrationNumber(key)
    if (
      number === undefined ||
      (lastNumber !== undefined && number <= lastNumber && isUnknown(key))
    ) {
      throw new Error(
        `Cannot migrate schema "${target.schemaName}": migration ${key} is applied, but the history lacks it`,
      )
    }
    lastApplied = { key, number }
  }
  const applied = new Set(versions.applied)
  const pending = keys.filter(key => !applied.has(key))
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

/**
 * Plans `migrate` of the first `count` pending migrations of `history` on `target`, of which the baseline is one.
 *
 * A target without keys runs the baseline, which records the keys that it replaces, and then the migrations after them.
 * A target with keys needs nothing of the baseline: it applies the migrations of the keys that it lacks, and the call rejects when the history lacks the module of a replaced one.
 */
function planMigrate(
  history: MigrationHistory,
  target: ResolvedTarget,
  versions: TargetVersions,
  count: number,
): CallPlan {
  const pending = getPendingKeys(history, target, versions)
  const { baseline } = history
  const runs: PlannedRun[] = []
  let start = 0
  if (baseline !== undefined && pending.length > 0) {
    if (versions.applied.length === 0) {
      // The pending keys of a target without keys start with all that the baseline replaces.
      runs.push({ key: undefined, direction: "up", keys: baseline.replaces })
      start = baseline.replaces.length
    } else {
      const modules = new Set(history.keys)
      const withoutModules = pending.filter(key => !modules.has(key))
      if (withoutModules.length > 0) {
        throw new Error(
          `Cannot migrate schema "${target.schemaName}": it has applied migrations but not ${withoutModules.join(", ")}, which the baseline replaces, and the history lacks their modules; migrate it with a version of the history that has them`,
        )
      }
    }
  }
  for (let index = start; index < pending.length && runs.length < count; index++) {
    runs.push(planMigration(pending[index]!, "up"))
  }
  return toCallPlan(runs)
}

/**
 * Plans the rollback of the last `count` applied migrations of `target`, in the order of rolling back; `action` names the call in its errors.
 *
 * It rejects applied keys that the history lacks, since it cannot run the `down` of a migration it does not have.
 *
 * With a baseline, `count` counts the applied keys from the first key that the baseline replaces on, or the replaced keys as one migration when the history keeps no module of them.
 * A call that undoes them all undoes the migrations after the replaced ones, and then the replaced ones together by `down` of the baseline, which requires every replaced key on the target and removes its keys up to the last of them.
 * Another call undoes each migration by its own `down`, and rejects when it reaches a replaced key without a module; it never reaches the first replaced key, whose own `down` would leave a target without keys on a schema that the migrations before that key built.
 */
function planUndo(
  history: MigrationHistory,
  target: ResolvedTarget,
  versions: TargetVersions,
  count: number,
  action: string,
): PlannedRun[] {
  const { applied } = versions
  const unknown = applied.find(createUnknownKeyCheck(history, listHistoryKeys(history)))
  if (unknown !== undefined) {
    throw new Error(
      `Cannot ${action} schema "${target.schemaName}": migration ${unknown} is applied, but the history lacks it`,
    )
  }
  const runs: PlannedRun[] = []
  if (applied.length === 0) {
    return runs
  }
  const { baseline } = history
  // Index of the first applied key that the call undoes by its own `down`.
  let start = Math.max(applied.length - count, 0)
  // Keys that `down` of the baseline removes, when the call runs it.
  let baselineKeys: string[] | undefined
  if (baseline !== undefined) {
    const { replaces } = baseline
    const moduleCount = countReplacedModules(history, baseline)
    const firstIndex = findFirstIndexFromNumber(applied, getMigrationNumber(replaces[0]!)!)
    const afterIndex = findFirstIndexFromNumber(applied, getMigrationNumber(replaces.at(-1)!)! + 1n)
    const total =
      moduleCount === 0
        ? applied.length - afterIndex + (afterIndex > firstIndex ? 1 : 0)
        : applied.length - firstIndex
    if (count >= total) {
      const present = new Set(applied)
      const missing = replaces.filter(key => !present.has(key))
      if (missing.length > 0) {
        throw new Error(
          `Cannot ${action} schema "${target.schemaName}": ${replaces[0]!}, the first migration that the baseline replaces, is undone only by down of the baseline, which requires every migration that it replaces, and the schema has not applied ${missing.join(", ")}; apply them with migrate first`,
        )
      }
      start = afterIndex
      // The keys before the first replaced one go too, since `down` of the baseline undoes what their migrations built too.
      baselineKeys = applied.slice(0, afterIndex).reverse()
    } else {
      const moduleIndex =
        moduleCount === 0
          ? afterIndex
          : findFirstIndexFromNumber(
              applied,
              getMigrationNumber(replaces[replaces.length - moduleCount]!)!,
            )
      if (start < moduleIndex) {
        throw new Error(
          `Cannot ${action} schema "${target.schemaName}": the baseline replaces migration ${applied[moduleIndex - 1]!}, and the history lacks its module; undo fewer migrations, or every migration of the schema, which undoes the replaced ones by down of the baseline`,
        )
      }
    }
  }
  for (let index = applied.length - 1; index >= start; index--) {
    runs.push(planMigration(applied[index]!, "down"))
  }
  if (baselineKeys !== undefined) {
    runs.push({ key: undefined, direction: "down", keys: baselineKeys })
  }
  return runs
}

/** Returns the run of the migration of `key` in `direction`, which records its key. */
function planMigration(key: string, direction: MigrationDirection): PlannedRun {
  return { key, direction, keys: [key] }
}

/** Returns the index of the first of `keys`, which are in the order of their numbers, whose number is at least `number`, or their length when no key has such a number. */
function findFirstIndexFromNumber(keys: readonly string[], number: bigint): number {
  const index = keys.findIndex(key => getMigrationNumber(key)! >= number)
  return index === -1 ? keys.length : index
}

/**
 * Plans the call from the versions of `opened`, and, when the plan has runs, locks the target, reads its versions again, loads the migrations that `plan` chooses from them, runs them, and resolves to the keys of that plan.
 *
 * `plan` rejects what the call rejects, so that a call rejects before it locks the target or changes anything, and a call without runs resolves to none without a lock and without loading a module.
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
  if (plan(opened.versions).runs.length === 0) {
    return []
  }
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

/** Runs `runs` in order in a transaction with the changes of `up` and `down` of their steps, recording the keys of each run after it runs, so that a baseline records the keys that it replaces in the transaction that runs it. */
async function runMigrations(target: ResolvedTarget, runs: readonly MigrationRun[]): Promise<void> {
  const database = toMigrationDatabase(target.database)
  for (const run of runs) {
    await runMigrationSteps(database, run.key, run.steps, run.direction)
    await recordRun(target, run)
  }
}

/** Records the keys of `run` as applied after `up`, and as not applied after `down`. */
async function recordRun(target: ResolvedTarget, run: MigrationRun): Promise<void> {
  await (run.direction === "up"
    ? insertVersions(target, run.keys)
    : deleteVersions(target, run.keys))
}

/** Loads the migrations of `runs` and the baseline in order, each once, before any of them runs, so that a module that fails to load changes nothing. */
async function loadMigrations(
  history: MigrationHistory,
  runs: readonly PlannedRun[],
): Promise<MigrationRun[]> {
  const steps = new Map<string | undefined, readonly MigrationStep[]>()
  const loaded: MigrationRun[] = []
  for (const run of runs) {
    const { key } = run
    let migration = steps.get(key)
    if (migration === undefined) {
      migration = await (key === undefined ? history.baseline!.load() : history.load(key))
      steps.set(key, migration)
    }
    loaded.push({ key, direction: run.direction, keys: run.keys, steps: migration })
  }
  return loaded
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
