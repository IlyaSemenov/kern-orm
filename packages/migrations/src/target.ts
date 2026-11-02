import type { Database, DriverResult, SqlStatement } from "kern-orm"

import type { MigrationHistory } from "./history"
import { compareMigrationNumbers, getMigrationNumber } from "./history"
import { quoteIdentifier } from "./sql"

/**
 * Target of migrations: a database and a PostgreSQL schema, the target schema.
 *
 * A `Db` gives its database and its PostgreSQL schema; a `Database`, or a `Db` bound without `schemaName`, targets `current_schema()`.
 */
export type MigrationTarget = Database | MigrationTargetDb

/** `Db` as a target of migrations; every `Db` fits it. */
export interface MigrationTargetDb {
  readonly $database: Database
  readonly $schemaName: string | undefined
}

/** Options of a call on a target. */
export interface MigrationTargetOptions {
  /** PostgreSQL schema of the target instead of that of its `Db`, such as the schema of a tenant that is being created. */
  schemaName?: string
}

/** Target whose PostgreSQL schema a call resolved at its start. */
export interface ResolvedTarget {
  readonly database: Database
  readonly schemaName: string
  readonly tableName: string
  /** Name of the table of versions qualified by the target schema, quoted. */
  readonly table: string
  /** Search path of the transaction of the migrations: the target schema followed by the schemas of the history. */
  readonly searchPath: readonly string[]
}

/** Versions of a target as a statement read them. */
export interface TargetVersions {
  readonly schemaExists: boolean
  readonly tableExists: boolean
  /** Keys of the applied migrations in the order of their numbers, followed by keys of another form; none without the table. */
  readonly applied: readonly string[]
}

/**
 * Resolves the PostgreSQL schema of `target` and reads its versions, outside a transaction of its own.
 *
 * It checks that the table of versions exists before reading it, since a failed statement would abort an enclosing transaction.
 */
export async function openTarget(
  target: MigrationTarget,
  history: MigrationHistory,
  options: MigrationTargetOptions,
): Promise<{ target: ResolvedTarget; versions: TargetVersions }> {
  const database = "$database" in target ? target.$database : target
  // The function of `schemaName` of a Db is called once, so that the call keeps one schema.
  const schemaName = options.schemaName ?? ("$database" in target ? target.$schemaName : undefined)
  const state = await readState(database, schemaName ?? null, history.tableName)
  const resolved: ResolvedTarget = {
    database,
    schemaName: state.schemaName,
    tableName: history.tableName,
    table: `${quoteIdentifier(state.schemaName)}.${quoteIdentifier(history.tableName)}`,
    searchPath: [state.schemaName, ...history.searchPath],
  }
  return { target: resolved, versions: await readApplied(resolved, state) }
}

/** Reads the versions of a resolved target again, such as after locking it. */
export async function readVersions(target: ResolvedTarget): Promise<TargetVersions> {
  const state = await readState(target.database, target.schemaName, target.tableName)
  return await readApplied(target, state)
}

/**
 * Locks the target until the end of the transaction, so that processes that migrate it at once apply each migration once.
 *
 * The lock belongs to the qualified name of the table of versions, so that different targets migrate at once.
 */
export async function lockTarget(target: ResolvedTarget): Promise<void> {
  await execute(target.database, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    target.table,
  ])
}

/**
 * Creates the target schema and the table of versions that `versions` lacks.
 *
 * `IF NOT EXISTS` keeps a statement from failing when another process has created them meanwhile, which would abort an enclosing transaction.
 * Checking `versions` first keeps PostgreSQL from sending a notice of an existing schema, which postgres.js logs by default.
 */
export async function createVersionsTable(
  target: ResolvedTarget,
  versions: TargetVersions,
): Promise<void> {
  if (!versions.schemaExists) {
    await execute(
      target.database,
      `CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(target.schemaName)}`,
    )
  }
  if (!versions.tableExists) {
    await execute(
      target.database,
      `CREATE TABLE IF NOT EXISTS ${target.table} (key text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    )
  }
}

/** Records migration `key` as applied. */
export async function insertVersion(target: ResolvedTarget, key: string): Promise<void> {
  await execute(target.database, `INSERT INTO ${target.table} (key) VALUES ($1)`, [key])
}

/** Records migration `key` as not applied. */
export async function deleteVersion(target: ResolvedTarget, key: string): Promise<void> {
  await execute(target.database, `DELETE FROM ${target.table} WHERE key = $1`, [key])
}

/** Existence of the target schema and its table of versions. */
interface TargetState {
  readonly schemaName: string
  readonly schemaExists: boolean
  readonly tableExists: boolean
}

/**
 * Resolves `schemaName`, or `current_schema()` when it is `null`, and checks that the schema and its table of versions exist, in one statement.
 *
 * It reads `pg_catalog` rather than calling `to_regclass`, whose lookups in the catalog cache of the connection miss a schema that another transaction committed while this one waited for the lock of the target.
 * It rejects a schema or table name longer than `max_identifier_length` bytes, which PostgreSQL would truncate, so that the check never misses a schema or a table that the migrator created.
 */
async function readState(
  database: Database,
  schemaName: string | null,
  tableName: string,
): Promise<TargetState> {
  const { rows } = await execute(
    database,
    `SELECT target.name, namespace.oid IS NOT NULL, EXISTS (SELECT FROM pg_catalog.pg_class WHERE relnamespace = namespace.oid AND relname = $2::text), current_setting('max_identifier_length'), octet_length(target.name), octet_length($2::text) FROM (SELECT coalesce($1::text, current_schema()) AS name) AS target LEFT JOIN pg_catalog.pg_namespace AS namespace ON namespace.nspname = target.name`,
    [schemaName, tableName],
  )
  const [name, schemaExists, tableExists, maxLength, schemaLength, tableLength] = rows[0]!
  if (name === null || name === undefined) {
    throw new Error(
      "Cannot resolve the target schema: current_schema() is NULL, since no schema of the search path exists; pass schemaName",
    )
  }
  const limit = Number(maxLength)
  for (const [kind, value, length] of [
    ["schema", name, schemaLength],
    ["table", tableName, tableLength],
  ] as const) {
    if (Number(length) > limit) {
      throw new Error(
        `Cannot use ${kind} name ${value}: it is longer than ${limit} bytes, and PostgreSQL would truncate it`,
      )
    }
  }
  return { schemaName: name, schemaExists: schemaExists === "t", tableExists: tableExists === "t" }
}

/** Reads the applied keys of a target whose table of versions `state` found. */
async function readApplied(target: ResolvedTarget, state: TargetState): Promise<TargetVersions> {
  if (!state.tableExists) {
    return { schemaExists: state.schemaExists, tableExists: false, applied: [] }
  }
  const { rows } = await execute(target.database, `SELECT key FROM ${target.table}`)
  const applied = rows.map(row => row[0]!)
  applied.sort(compareKeys)
  return { schemaExists: true, tableExists: true, applied }
}

/** Compares migration keys by their numbers, putting keys of another form last. */
function compareKeys(left: string, right: string): number {
  const leftNumber = getMigrationNumber(left)
  const rightNumber = getMigrationNumber(right)
  if (leftNumber !== undefined && rightNumber !== undefined) {
    return compareMigrationNumbers(leftNumber, rightNumber)
  }
  if (leftNumber !== rightNumber) {
    return leftNumber === undefined ? 1 : -1
  }
  return left < right ? -1 : left > right ? 1 : 0
}

/** Executes a statement of the migrator; `kern-orm` gives its values as text, which needs none of its types. */
function execute(
  database: Database,
  text: string,
  parameters: SqlStatement["parameters"] = [],
): Promise<DriverResult> {
  return database.execute({ text, parameters })
}
