// Database of the ORM: adds the binding of schemas and queries of SQL text without a `Db` to the `Database` of the database layer.

import type { Database as BaseDatabase, DatabaseOptions } from "../database/database"
import { createDatabase as createBaseDatabase } from "../database/database"
import type { InitialSqlQueryState, SqlQuery } from "../query/sql-query"
import type { SchemaRelations } from "../schema/relation"
import type { Schema, Tables } from "../schema/schema"
import { defineSchema } from "../schema/schema"

import type { AnyDb, BindOptions, Db } from "./db"
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
  /**
   * Starts a query of the SQL statement of the template, as `$query` of a `Db` does, for code without a `Db`.
   *
   * It names no tables of a `Db`: run a statement that interpolates them with `$query` of that `Db`.
   */
  query(strings: TemplateStringsArray, ...values: unknown[]): SqlQuery<InitialSqlQueryState>
}

/** Creates a database over a driver; its transactions are shared by every schema bound to it. */
export function createDatabase(options: DatabaseOptions): Database {
  const base = createBaseDatabase(options)
  // A Db of no tables runs the queries of the database, so that they name no tables of a schema.
  let tablelessDb: AnyDb | undefined
  const getTablelessDb = () => (tablelessDb ??= bindSchema(defineSchema(), database))
  const database: Database = {
    ...base,
    bind: (schema, options) => bindSchema(schema, database, options),
    query: (strings, ...values) => getTablelessDb().$query(strings, ...values),
  }
  return database
}
