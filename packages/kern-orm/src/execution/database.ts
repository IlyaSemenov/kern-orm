import type { InitialSqlQueryState, SqlQuery } from "../query/sql-query"
import type { SchemaRelations } from "../schema/relation"
import type { Schema, Tables } from "../schema/schema"
import { defineSchema } from "../schema/schema"

import type { AnyDb, BindOptions, Db } from "./db"
import { bindSchema } from "./db"
import type { Driver, DriverResult, SqlStatement } from "./driver"
import { TransactionCoordinator } from "./transaction"

/**
 * Physical database shared by all schemas bound to it.
 *
 * Its ambient transaction spans every schema bound to the same database, such as tenant and SaaS schemas.
 * Disposing it, such as with `await using`, closes it.
 */
export interface Database extends AsyncDisposable {
  /** Routes the statements and transactions of the database; `kern-orm/testing` runs test transactions and test fixtures through it. */
  readonly coordinator: TransactionCoordinator
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
  /** Executes a script of statements without parameters, as `$script` of a `Db` does, for code without a `Db`. */
  script(text: string): Promise<void>
  /**
   * Executes the script of the template, as `$script` of a `Db` does, for code without a `Db`.
   *
   * It names no tables of a `Db`: run a script that interpolates them with `$script` of that `Db`.
   */
  script(strings: TemplateStringsArray, ...values: unknown[]): Promise<void>
  /** Executes a compiled statement, such as of `$compile` of a `Db`, in the ambient transaction, or on the pool outside of one unless the database was created with `test: true`. */
  execute(statement: SqlStatement): Promise<DriverResult>
  /**
   * Runs `callback` in a transaction that queries of every bound schema join automatically.
   *
   * Inside an existing transaction, it starts a nested transaction.
   */
  transaction<T>(callback: () => Promise<T>, options?: TransactionOptions): Promise<T>
  /**
   * Runs `callback` in the current transaction without a nested transaction, or in a new transaction outside of one.
   *
   * A rejection of a callback that joined a transaction does not undo its changes: the enclosing transaction commits them unless it fails too.
   * A test transaction is not a transaction to join: there, it starts a nested transaction where it starts a transaction in production.
   */
  ensureTransaction<T>(callback: () => Promise<T>): Promise<T>
  /** Tells whether the code runs in a transaction, not counting test transactions, so that code under test sees what it sees in production. */
  isInTransaction(): boolean
  /** Rolls back the open test fixtures and closes the connections of the driver once the running transactions end. */
  close(): Promise<void>
}

/** Options of `transaction` of a `Database` and `$transaction` of a `Db`. */
export interface TransactionOptions {
  /**
   * PostgreSQL schemas where the unqualified names of the statements of the transaction resolve, in their order, such as the schema of a tenant followed by the schema of extensions.
   *
   * It applies to the statements of the callback, including those of its nested transactions, until the transaction ends; a nested transaction then restores the search path of the enclosing transaction.
   */
  searchPath?: readonly string[]
}

/** Options of `createDatabase`. */
export interface DatabaseOptions {
  driver: Driver
  /** Rejects queries and transactions outside the test transactions and the seeds of test fixtures of `kern-orm/testing`, so that every statement of the tests runs in a transaction that rolls back. */
  test?: boolean
}

/** Creates a database over a driver; its transactions are shared by every schema bound to it. */
export function createDatabase({ driver, test }: DatabaseOptions): Database {
  const coordinator = new TransactionCoordinator(driver, test)
  // A Db of no tables runs the statements of the database, so that they name no tables of a schema.
  let tablelessDb: AnyDb | undefined
  const getTablelessDb = () => (tablelessDb ??= bindSchema(defineSchema(), database))
  const database: Database = {
    coordinator,
    bind: (schema, options) => bindSchema(schema, database, options),
    query: (strings, ...values) => getTablelessDb().$query(strings, ...values),
    script: (script: string | TemplateStringsArray, ...values: unknown[]) =>
      typeof script === "string"
        ? coordinator.executeScript(script)
        : getTablelessDb().$script(script, ...values),
    execute: statement => coordinator.execute(statement),
    transaction: (callback, options) => coordinator.transaction(callback, options),
    ensureTransaction: callback => coordinator.ensureTransaction(callback),
    isInTransaction: () => coordinator.isInTransaction(),
    close: () => coordinator.close(),
    [Symbol.asyncDispose]: () => coordinator.close(),
  }
  return database
}
