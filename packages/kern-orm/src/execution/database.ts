// Database of the ORM: adds the binding of schemas to the `Database` of the database layer.

import type { Database as BaseDatabase, DatabaseOptions } from "../database/database"
import { createDatabase as createBaseDatabase } from "../database/database"
import type { SchemaRelations } from "../schema/relation"
import type { Schema, Tables } from "../schema/schema"

import type { BindOptions, Db } from "./db"
import { bindSchema } from "./db"

/**
 * Physical database shared by all schemas bound to it.
 *
 * Its ambient transaction spans every schema bound to the same database, such as tenant and SaaS schemas.
 * Disposing it, such as with `await using`, closes it.
 */
export interface Database extends BaseDatabase {
  /**
   * Binds a schema to this database, placing its tables in a PostgreSQL schema.
   *
   * A database can bind several schemas, which share its connections and transactions.
   */
  bind<T extends Tables, R extends SchemaRelations>(
    schema: Schema<T, R>,
    options?: BindOptions,
  ): Db<T, R>
}

/** Creates a database over a driver; its transactions are shared by every schema bound to it. */
export function createDatabase(options: DatabaseOptions): Database {
  const database: Database = {
    ...createBaseDatabase(options),
    bind: (schema, options) => bindSchema(schema, database, options),
  }
  return database
}
