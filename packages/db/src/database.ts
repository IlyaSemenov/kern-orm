import type { Connection, Driver, DriverResult, SqlStatement } from "./driver"
import type { SqlValue } from "./sql/fragment"
import { compileFragment, compileScript, sql } from "./sql/fragment"
import type { InitialSqlQueryState, SqlQuery } from "./sql/query"
import { startSqlQuery } from "./sql/query"
import { TransactionCoordinator } from "./transaction/coordinator"

/**
 * Physical database: the connections of a driver, and the ambient transactions and sessions that route statements to them.
 *
 * Disposing it, such as with `await using`, closes it.
 */
export interface Database extends AsyncDisposable {
  /**
   * Executes a script of statements without parameters, such as DDL separated by semicolons, in the ambient transaction or session, or on the pool outside of one; outside a transaction, PostgreSQL runs them in one implicit transaction.
   *
   * The script must not start or end transactions, which the database tracks.
   */
  script(text: string): Promise<void>
  /**
   * Executes the script of the template as `script` of its text does.
   *
   * It interpolates SQL fragments without parameters, such as a name of `identifier`; it rejects values, since a script has no parameters.
   */
  script(strings: TemplateStringsArray, ...values: SqlValue[]): Promise<void>
  /**
   * Starts a query of the SQL statement of the template, which resolves to the number of the rows of its command tag when awaited, such as the rows that an `UPDATE` changes; `select`, `get`, and `pluck` return the fields of its rows instead.
   *
   * It interpolates SQL fragments, such as a name of `identifier`, as SQL, and other values as parameters, as `sql` does.
   */
  query(strings: TemplateStringsArray, ...values: SqlValue[]): SqlQuery<InitialSqlQueryState>
  /**
   * Executes a compiled statement, such as of `$compile` of a `Db`, in the ambient transaction or session, or on the pool outside of one unless the database was created with `test: true`.
   *
   * It passes `statement` to the driver as the same object, so that a query builder can pass fields of its own to a driver, such as the values that `getNativeParameters` of the postgres.js driver reads.
   */
  execute(statement: SqlStatement): Promise<DriverResult>
  /**
   * Runs `callback` in a transaction that queries of every bound schema join automatically.
   *
   * Inside an existing transaction, it starts a nested transaction.
   */
  transaction<T>(callback: () => Promise<T>, options?: TransactionOptions): Promise<T>
  /**
   * Runs `callback` in an external transaction: a transaction that other code started on `connection` and ends itself, such as a transaction of another library, so that the statements of the callback commit or roll back with it.
   *
   * Statements of this database, also of every schema bound to it, join it automatically, as they join a transaction of `transaction`, and `transaction` in the callback starts a nested transaction.
   * The database sends no `BEGIN`, `COMMIT`, or `ROLLBACK` and does not release the connection.
   * The transaction must stay open until the returned promise settles, and its owner must roll it back when the promise rejects for a nested transaction that failed to end.
   * A physical connection must run one external transaction at a time, also through several `ExternalConnection` objects over it: the nested transactions of two that run at once take savepoints of the same connection, so that one can roll back the statements of the other.
   * It rejects for a driver, inside a transaction or a session of the database, and on a database created with `test: true`.
   */
  externalTransaction<T>(connection: ExternalConnection, callback: () => Promise<T>): Promise<T>
  /**
   * Runs `callback` in the current transaction without a nested transaction, or in a new transaction outside of one.
   *
   * A rejection of a callback that joined a transaction does not undo its changes: the enclosing transaction commits them unless it fails too.
   * A test transaction is not a transaction to join: there, it starts a nested transaction where it starts a transaction in production.
   */
  ensureTransaction<T>(callback: () => Promise<T>): Promise<T>
  /** Tells whether the code runs in a transaction, also an external one, not counting test transactions, so that code under test sees what it sees in production. */
  isInTransaction(): boolean
  /**
   * Tells whether a statement of the code runs in a transaction block of PostgreSQL, counting external transactions and test transactions, such as to choose a statement that PostgreSQL rejects there, `CREATE INDEX CONCURRENTLY`.
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
   * Opens a session that the callbacks of its `run` share until it is closed, such as to hold a lock of `tryLock` on one connection for as long as a process works.
   *
   * It rejects where `session` rejects: inside a transaction, also a test transaction, inside another session, and on a database created with `test: true`.
   */
  openSession(options?: SessionOptions): Promise<OpenedSession>
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
  /**
   * Rolls back the open test fixtures and closes the connections of the driver once the running transactions and sessions end, including the sessions of `openSession`, which end when they are closed.
   *
   * It waits for an external transaction only when the client of the driver holds the connection of that transaction too.
   */
  close(): Promise<void>
}

/**
 * Connection of an external transaction: it runs the statements and scripts of the database in a transaction that other code started and ends, by the contract of `execute` and `executeScript` of a `Connection`.
 *
 * It sends parameters as text without a declared type and returns values as text, runs its statements and scripts one at a time in the order of calls, and rejects with `QueryError` and `ConnectionError`, as a connection of a driver does.
 */
export type ExternalConnection = Pick<Connection, "execute" | "executeScript">

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

/** Options of `session` and `openSession` of a `Database` and `$session` of a `Db`. */
export interface SessionOptions {
  /**
   * PostgreSQL schemas where the unqualified names of the statements of the session resolve, in their order, such as the schema of a tenant followed by the schema of extensions.
   *
   * It applies to the statements of the session, including those of its transactions, until the session ends, which restores the search path that its connection had.
   */
  searchPath?: readonly string[]
}

/**
 * Open session of `openSession` of a `Database`: one connection outside a transaction that the callbacks of `run` share until the session is closed.
 *
 * Disposing it, such as with `await using`, closes it.
 */
export interface OpenedSession extends AsyncDisposable {
  /**
   * Runs `callback` in the session, as the callback of `session` runs: its statements run on the connection of the session, `transaction` starts a transaction on it, and `tryLock` outside such a transaction holds its lock until the session is closed.
   *
   * It can be called any number of times, also from code that did not open the session, such as a timer.
   * It rejects without calling `callback` once the session is closed, after a `ConnectionError` on its connection, while a transaction of the session runs, and inside a transaction or another session.
   * While the session is closing, it rejects too, unless a callback that is still running calls it.
   * `tryLock` of a key that the session holds answers without a statement, so it does not tell that the connection is lost, and the lock with it; a statement in the session does.
   */
  run<T>(callback: () => Promise<T>): Promise<T>
  /**
   * Closes the session: waits for the callbacks of `run` that are running, then releases its locks, restores its settings, and returns its connection to the pool.
   *
   * A callback must settle for the session to close, so give a wait in it an end, such as a `signal` of `pollLock`; until then, the session keeps its connection, and the closing of the database waits for it.
   * Call it outside the callbacks of `run`: inside a callback that is running, it rejects, since it would wait for that callback.
   * Otherwise it never rejects, and its failures go to `onReleaseError` of the database, as those of `session` do: a failure to release the locks or to restore the settings, unless it is a `ConnectionError`, and a failure to release the connection, whatever its error.
   * A transaction of the session that no callback awaited rolls back and rejects, unless its own end has started, such as its `COMMIT`, whose result the closing then waits for.
   * A repeated call returns the first closing.
   */
  close(): Promise<void>
}

/** Options of `pollLock` of a `Database` and `$pollLock` of a `Db`. */
export interface PollLockOptions {
  /** Signal that stops waiting for the lock, such as `AbortSignal.timeout(60_000)`: once it aborts, `pollLock` makes no more attempts. */
  signal?: AbortSignal
}

/** Options of `createDatabase`. */
export interface DatabaseOptions {
  driver: Driver
  /** Rejects queries and transactions outside the test transactions and the seeds of test fixtures of `kern-db/testing`, so that every statement of the tests runs in a transaction that rolls back. */
  test?: boolean
  /**
   * Receives a failure to release the connection of a transaction or a session, or to release the advisory locks or restore the settings of a session, such as to log it; the failure does not change the result or error of the transaction or session.
   *
   * Without it, the failure goes to `console.error`.
   */
  onReleaseError?: (error: unknown) => void
}

/** Marks a database of `createDatabase` of any copy of kern-db, which `isDatabase` of another copy recognizes. */
const databaseBrand = /* @__PURE__ */ Symbol.for("kern-db.Database")

/**
 * Checks whether `value` is a database of `createDatabase`, also of another copy of kern-db, such as to reject a client of PostgreSQL or a `Db` of kern-orm passed instead of a database.
 *
 * It checks the brand that `createDatabase` sets, so it rejects a spread copy of a database.
 */
export function isDatabase(value: unknown): value is Database {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[databaseBrand] === true
  )
}

// The coordinator of each database, which `Database` does not expose, so that its type does not depend on the private members of the class of one copy of the module; the test helpers find it here.
const coordinators = new WeakMap<Database, TransactionCoordinator>()

/**
 * Returns the transaction coordinator of a database of `createDatabase`, such as for the test helpers.
 *
 * It throws for another object, such as a copy of a database or a database of another copy of this module, which has no coordinator here.
 */
export function getCoordinator(database: Database): TransactionCoordinator {
  const coordinator = coordinators.get(database)
  if (coordinator === undefined) {
    throw new TypeError(
      "The database was not created by createDatabase of this copy of the package",
    )
  }
  return coordinator
}

/** Creates a database over a driver. */
export function createDatabase({ driver, ...options }: DatabaseOptions): Database {
  const coordinator = new TransactionCoordinator(driver, options)
  const database: Database = {
    // An async function, so that a template that it rejects rejects the promise.
    async script(script: string | TemplateStringsArray, ...values: SqlValue[]) {
      return coordinator.executeScript(
        typeof script === "string" ? script : compileScript(sql(script, ...values)),
      )
    },
    query(strings, ...values) {
      // The template rejects a value that it does not take when the query is created, so that the error points at the template.
      const fragment = sql(strings, ...values)
      return startSqlQuery(() => compileFragment(fragment), database)
    },
    execute: statement => coordinator.execute(statement),
    transaction: (callback, options) => coordinator.transaction(callback, options),
    externalTransaction: (connection, callback) =>
      coordinator.externalTransaction(connection, callback),
    ensureTransaction: callback => coordinator.ensureTransaction(callback),
    isInTransaction: () => coordinator.isInTransaction(),
    isInTransactionBlock: () => coordinator.isInTransactionBlock(),
    session: (callback, options) => coordinator.session(callback, options),
    openSession: options => coordinator.openSession(options),
    lock: key => coordinator.lock(key),
    tryLock: key => coordinator.tryLock(key),
    pollLock: (key, options) => coordinator.pollLock(key, options),
    close: () => coordinator.close(),
    [Symbol.asyncDispose]: () => coordinator.close(),
  }
  // Not enumerable, so that spreading a database does not copy its brand.
  Object.defineProperty(database, databaseBrand, { value: true })
  coordinators.set(database, coordinator)
  return database
}
