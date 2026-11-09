import type { TextValue } from "../type/type"

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
  /** Executes a statement on any pooled connection. */
  execute(statement: SqlStatement): Promise<DriverResult>
  /** Executes a script of statements without parameters, such as DDL separated by semicolons, on any pooled connection, where PostgreSQL runs them in one implicit transaction. */
  executeScript(text: string): Promise<void>
  /** Reserves a dedicated connection, such as for a transaction. */
  acquire(): Promise<Connection>
  /**
   * Closes the connections once the statements on the pool and the transactions on reserved connections end.
   *
   * From the call, it rejects a new statement or script on the pool and a new connection with `ConnectionError`.
   */
  close(): Promise<void>
}

/** Connection reserved by a driver, such as for a transaction. */
export interface Connection {
  /**
   * Executes a statement on the connection.
   *
   * Statements and scripts run one at a time in the order of calls, so a statement sent before `COMMIT` or `ROLLBACK` completes before it.
   */
  execute(statement: SqlStatement): Promise<DriverResult>
  /** Executes a script of statements without parameters on the connection, in the order of calls with its statements. */
  executeScript(text: string): Promise<void>
  /**
   * Returns the connection to the pool.
   *
   * Without `failure`, the connection is idle: no transaction ran on it, or its `COMMIT` or `ROLLBACK` completed.
   * With `failure`, the last statement on the connection failed, such as `BEGIN`, `COMMIT`, or `ROLLBACK`, so the connection may be in a transaction or lost: the driver returns it to the pool only once it is idle, and never returns a connection it lost.
   */
  release(failure?: TransactionFailure): void | Promise<void>
}

/** Failure of the last statement on a reserved connection, after which the connection may not be idle. */
export interface TransactionFailure {
  readonly error: unknown
}
