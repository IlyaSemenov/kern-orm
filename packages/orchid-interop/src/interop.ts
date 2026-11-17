import type { Database, DatabaseOptions } from "kern-db"
import { createDatabase } from "kern-db"
import type { OrchidORM, OrchidORMSetupOptions, OrmTableThunks } from "orchid-orm"
import type { PostgresJsAdapterOptions } from "orchid-orm/postgres-js"
import { Adapter as PostgresJsAdapter } from "orchid-orm/postgres-js"
import type { Sql } from "postgres"

import { rejectUnsupported } from "./adapter"
import { createOrchidDb } from "./orchid"
import { createOrchidPostgresJsDriver } from "./postgres-js"

/** Connection options of Orchid's postgres.js adapter that the shared pool does not support, with their replacements where they have one. */
const unsupportedConnectionOptions = {
  schema: "connection.schema; use orchid.schema",
  setConfig: "connection.setConfig; set the settings in connection.connection",
  connectRetry: "connection.connectRetry",
  types: "connection.types",
} satisfies Partial<Record<keyof PostgresJsAdapterOptions, string>>

/** Shared database and Orchid instance; close either one to close their single pool. */
export interface OrchidInterop<T extends OrmTableThunks, V extends OrmTableThunks = {}> {
  /** Kern database to bind schemas to and use for transactions and test helpers. */
  database: Database
  /** Orchid instance using the same database for queries and transactions. */
  orchid: OrchidORM<T, V>
}

/** Connection, database lifecycle, and Orchid query options of the shared database. */
export interface OrchidInteropOptions<V extends OrmTableThunks = {}> {
  /** postgres.js connection options, configured with Orchid's codecs. */
  connection: Omit<PostgresJsAdapterOptions, keyof typeof unsupportedConnectionOptions>
  /** Kern lifecycle options, including `test: true` for its transaction test helpers. */
  database?: Omit<DatabaseOptions, "driver">
  /** Orchid schema, logging, table, and view options. */
  orchid?: OrchidORMSetupOptions<V> & { db?: never }
}

/**
 * Opens one postgres.js pool for Kern and existing Orchid tables, with transactions owned by Kern.
 * Initializes database-defined codecs before returning, unless `fetch_types` of the connection is `false`; close `database` or `orchid` when finished.
 * A failed initialization closes the pool; if closing fails too, it rejects with a `SuppressedError` whose `error` is the error of closing and `suppressed` the error of the initialization.
 */
export async function createOrchidInterop<T extends OrmTableThunks, V extends OrmTableThunks = {}>(
  options: OrchidInteropOptions<V>,
  tables: T,
): Promise<OrchidInterop<T, V>> {
  for (const key in unsupportedConnectionOptions) {
    if ((options.connection as Record<string, unknown>)[key] !== undefined) {
      rejectUnsupported(
        unsupportedConnectionOptions[key as keyof typeof unsupportedConnectionOptions],
      )
    }
  }
  const client = PostgresJsAdapter.configure(options.connection) as Sql
  let database: Database | undefined
  try {
    database = createDatabase({ ...options.database, driver: createOrchidPostgresJsDriver(client) })
    // postgres.js discovers database-defined types on startup; use the same pool that will execute every query.
    await client.unsafe("SELECT 1").execute()
    const orchid = createOrchidDb(database, client, tables, options.orchid)
    return { database, orchid }
  } catch (error) {
    try {
      await (database ? database.close() : client.end())
    } catch (cleanup) {
      throw new SuppressedError(
        cleanup,
        error,
        "Could not close the connection pool after initialization failed",
      )
    }
    throw error
  }
}
