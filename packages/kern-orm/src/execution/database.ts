import type { InitialSqlQueryState, SqlQuery } from "../query/sql-query"
import type { SchemaRelations } from "../schema/relation"
import type { Schema, Tables } from "../schema/schema"
import { defineSchema } from "../schema/schema"

import type { AnyDb, BindOptions, Db } from "./db"
import { bindSchema } from "./db"
import type { Driver, DriverResult, SqlStatement } from "./driver"
import { TransactionCoordinator } from "./transaction/coordinator"

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
  /** Executes a compiled statement, such as of `$compile` of a `Db`, in the ambient transaction or session, or on the pool outside of one unless the database was created with `test: true`. */
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
  /**
   * Tells whether a statement of the code runs in a transaction block of PostgreSQL, counting test transactions, such as to choose a statement that PostgreSQL rejects there, `CREATE INDEX CONCURRENTLY`.
   *
   * It is `false` in a session outside its transactions.
   */
  isInTransactionBlock(): boolean
  /**
   * Runs `callback` in a session: on one connection outside a transaction, such as for statements that PostgreSQL rejects in a transaction block and that share a setting of the connection, such as its search path.
   *
   * Statements of every bound schema join the session automatically, each in a transaction of its own, and `transaction` in the callback starts a transaction on the connection of the session.
   * A rejection of `callback` undoes nothing.
   * It rejects inside a transaction, also a test transaction, inside another session, and on a database created with `test: true`.
   */
  session<T>(callback: () => Promise<T>, options?: SessionOptions): Promise<T>
  /**
   * Takes the advisory lock of `key` until the transaction ends, waiting while another transaction or session holds it, such as to keep processes from running the same job at once.
   *
   * It rejects where `isInTransaction()` is `false`, since outside a transaction the lock would end with its statement; in a session, take the lock with `tryLock`, which does not wait.
   * A nested transaction that rolls back releases the locks it took.
   */
  lock(key: string): Promise<void>
  /**
   * Takes the advisory lock of `key` unless another transaction or session holds it, and tells whether it took it, such as to skip a job that another process is running.
   *
   * In a transaction, it holds the lock until the transaction ends, as `lock` does; in a session outside its transactions, until the session ends.
   * It rejects outside both, since the lock would end with its statement; a test transaction alone does not count.
   */
  tryLock(key: string): Promise<boolean>
  /**
   * Takes the advisory lock of `key` in a session until the session ends, calling `tryLock` again after a pause until it takes the lock, such as to let one process at a time run statements outside a transaction.
   *
   * It rejects outside a session, and in a transaction, where `lock` waits for the lock.
   * Once `signal` of `options` aborts, such as `AbortSignal.timeout(60_000)`, it makes no more attempts and rejects with the reason of the signal, unless the attempt that is running takes the lock.
   */
  pollLock(key: string, options?: PollLockOptions): Promise<void>
  /** Rolls back the open test fixtures and closes the connections of the driver once the running transactions and sessions end. */
  close(): Promise<void>
}

/** Isolation level of a transaction in PostgreSQL. */
export type IsolationLevel = "read committed" | "repeatable read" | "serializable"

/** Options of `transaction` of a `Database` and `$transaction` of a `Db`. */
export interface TransactionOptions {
  /**
   * Isolation level of the transaction, such as `serializable`.
   *
   * A nested transaction runs at the level of its transaction: given another level, it rejects.
   */
  isolation?: IsolationLevel
  /**
   * PostgreSQL schemas where the unqualified names of the statements of the transaction resolve, in their order, such as the schema of a tenant followed by the schema of extensions.
   *
   * It applies to the statements of the callback, including those of its nested transactions, until the transaction ends; a nested transaction then restores the search path of the enclosing transaction.
   */
  searchPath?: readonly string[]
}

/** Options of `session` of a `Database` and `$session` of a `Db`. */
export interface SessionOptions {
  /**
   * PostgreSQL schemas where the unqualified names of the statements of the session resolve, in their order, such as the schema of a tenant followed by the schema of extensions.
   *
   * It applies to the statements of the callback, including those of its transactions, until the session ends, which restores the search path that its connection had.
   */
  searchPath?: readonly string[]
}

/** Options of `pollLock` of a `Database` and `$pollLock` of a `Db`. */
export interface PollLockOptions {
  /** Signal that stops waiting for the lock, such as `AbortSignal.timeout(60_000)`: once it aborts, `pollLock` makes no more attempts. */
  signal?: AbortSignal
}

/** Options of `createDatabase`. */
export interface DatabaseOptions {
  driver: Driver
  /** Rejects queries and transactions outside the test transactions and the seeds of test fixtures of `kern-orm/testing`, so that every statement of the tests runs in a transaction that rolls back. */
  test?: boolean
  /**
   * Receives a failure to release the connection of a transaction or a session, or to release the advisory locks or restore the settings of a session, such as to log it; the failure does not change the result or error of the transaction or session.
   *
   * Without it, the failure goes to `console.error`.
   */
  onReleaseError?: (error: unknown) => void
}

/** Creates a database over a driver; its transactions are shared by every schema bound to it. */
export function createDatabase({ driver, ...options }: DatabaseOptions): Database {
  const coordinator = new TransactionCoordinator(driver, options)
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
    isInTransactionBlock: () => coordinator.isInTransactionBlock(),
    session: (callback, options) => coordinator.session(callback, options),
    lock: key => coordinator.lock(key),
    tryLock: key => coordinator.tryLock(key),
    pollLock: (key, options) => coordinator.pollLock(key, options),
    close: () => coordinator.close(),
    [Symbol.asyncDispose]: () => coordinator.close(),
  }
  return database
}
