import type { SchemaRelations } from "../schema/relation"
import type { Schema, Tables } from "../schema/schema"

import type { BindOptions, Db } from "./db"
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
  /** Executes a statement in the ambient transaction, or on the pool outside of one unless the database was created with `test: true`. */
  execute(statement: SqlStatement): Promise<DriverResult>
  /**
   * Runs `callback` in a transaction that queries of every bound schema join automatically.
   *
   * Inside an existing transaction, it starts a nested transaction.
   */
  transaction<T>(callback: () => Promise<T>): Promise<T>
  /** Rolls back the open test fixtures and closes the connections of the driver once the running transactions end. */
  close(): Promise<void>
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
  const database: Database = {
    coordinator,
    bind: (schema, options) => bindSchema(schema, database, options),
    execute: statement => coordinator.execute(statement),
    transaction: callback => coordinator.transaction(callback),
    close: () => coordinator.close(),
    [Symbol.asyncDispose]: () => coordinator.close(),
  }
  return database
}
