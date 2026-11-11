/** PostgreSQL text representation of a value, as a driver sends a parameter and returns a value of a result; `null` is SQL `NULL`. */
export type TextValue = string | null

/** SQL statement ready for a driver. */
export interface SqlStatement {
  readonly text: string
  /** Text representations of the parameters; PostgreSQL infers their types from the statement text. */
  readonly parameters: readonly TextValue[]
}

/** Creates a statement from SQL text and the text representations of its parameters, such as `createStatement("BEGIN")`. */
export function createStatement(text: string, parameters: readonly TextValue[] = []): SqlStatement {
  return { text, parameters }
}

/** Result of a statement. */
export interface DriverResult {
  /** Command of the tag that PostgreSQL completed the statement with, such as `SELECT` or `ROLLBACK` for a `COMMIT` of a failed transaction; a driver may give only the first word of a tag of several words, such as `CREATE` of `CREATE TABLE`; `null` for a statement that PostgreSQL completes without a tag, such as an empty text or only a comment. */
  readonly command: string | null
  /** Number of rows that the command tag reports, such as the rows that an `UPDATE` changes, also without `RETURNING`; `0` when PostgreSQL reports none, such as for `BEGIN` or a statement without a command tag. */
  readonly count: number
  /** Names of the result columns in their order, also when the statement returns no rows; none for a statement without result columns, such as `BEGIN` or an `UPDATE` without `RETURNING`. */
  readonly columns: readonly string[]
  /** Rows as PostgreSQL text representations of their values, in the order of the result columns. */
  readonly rows: readonly (readonly TextValue[])[]
}

/**
 * Physical database access: transport, pooling, and connections.
 *
 * A driver sends parameters as text without a declared type, so that the statement text alone determines their types, and returns values as text without parsing them.
 * It rejects with `QueryError` a statement or script that PostgreSQL rejected, whose connection stays usable, and with `ConnectionError` any other failure of a statement, a script, or a connection.
 */
export interface Driver {
  /**
   * Executes a statement on any pooled connection.
   *
   * It rejects a statement that leaves its connection in a transaction, such as `BEGIN`, with `ConnectionError`, and leaves no transaction open on the pool.
   */
  execute(statement: SqlStatement): Promise<DriverResult>
  /**
   * Executes a script of statements without parameters, such as DDL separated by semicolons, on any pooled connection, where PostgreSQL runs them in one implicit transaction.
   *
   * It rejects a script that leaves its connection in a transaction as `execute` rejects such a statement.
   * A script whose statement PostgreSQL rejected in that transaction may reject with that `QueryError` instead.
   * Either way, no transaction stays open on the pool.
   */
  executeScript(text: string): Promise<void>
  /** Reserves a dedicated connection, such as for a transaction or a session. */
  acquire(): Promise<Connection>
  /**
   * Closes the connections once the statements on the pool and the transactions and sessions on reserved connections end.
   *
   * From the call, it rejects a new statement or script on the pool and a new connection with `ConnectionError`.
   */
  close(): Promise<void>
}

/**
 * Checks whether `value` is a driver: an object with the methods of `Driver`, such as to reject a client of PostgreSQL passed instead of its driver.
 *
 * It checks the methods rather than a brand, since an application may write a driver of its own.
 */
export function isDriver(value: unknown): value is Driver {
  const driver = value as Partial<Driver> | null
  return (
    (typeof driver === "object" || typeof driver === "function") &&
    driver !== null &&
    typeof driver.execute === "function" &&
    typeof driver.executeScript === "function" &&
    typeof driver.acquire === "function" &&
    typeof driver.close === "function"
  )
}

/** Connection reserved by a driver, such as for a transaction or a session. */
export interface Connection {
  /**
   * Executes a statement on the connection.
   *
   * Statements and scripts run one at a time in the order of calls, so a statement sent before `COMMIT` or `ROLLBACK` completes before it.
   * A connection that is lost rejects every later statement and script with `ConnectionError`, in a transaction and outside one, rather than running it on a new connection.
   */
  execute(statement: SqlStatement): Promise<DriverResult>
  /** Executes a script of statements without parameters on the connection, in the order of calls with its statements. */
  executeScript(text: string): Promise<void>
  /**
   * Returns the connection to the pool once its statements complete, if PostgreSQL reported an idle transaction status after the last statement; otherwise the driver closes it, which rolls back a transaction left on it.
   *
   * The driver tells by itself how the statements on the connection ended.
   * After a `ConnectionError`, a statement may still run or the connection may be lost, so the driver closes the connection, unless its client refused the statement without breaking the exchange of messages and still reads the status, such as postgres.js 4 for a statement of too many parameters.
   */
  release(): void | Promise<void>
}
