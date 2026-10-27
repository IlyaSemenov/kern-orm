import type { Driver, DriverResult, SqlStatement } from "kern-orm"
import type { ReservedSql, Sql } from "postgres"

/** OID of the PostgreSQL `unknown` pseudo-type; postgres.js sends such parameters as they are, and PostgreSQL infers their types. */
const unknownType = 705

/** PostgreSQL error codes by their condition names. */
const errorCodes = {
  in_failed_sql_transaction: "25P02",
} as const

/** Options of `postgresJsDriver`. */
export interface PostgresJsDriverOptions {
  /**
   * Seconds that closing waits for work that may never end, 5 by default.
   *
   * Closing waits for the running transactions of the driver without a limit.
   * Once none of them holds a connection, the transactions still waiting for a connection get `closeTimeout` to get one.
   * When a transaction still waits, or a connection stays reserved after a transaction failed to end, closing then gives the remaining work of the client, including queries outside transactions and the work of other code on the same client, `closeTimeout` before it terminates the connections and rejects the waiting transactions.
   */
  closeTimeout?: number
}

/**
 * Creates a kern-orm driver over a postgres.js client; the client keeps managing its pool.
 *
 * postgres.js cannot close a reserved connection: after a transaction fails to end, a lost connection is left to the pool to reconnect, and a connection that stays in an unknown state stays reserved.
 * Closing the driver ends the supplied client.
 */
export function postgresJsDriver(sql: Sql, options: PostgresJsDriverOptions = {}): Driver {
  const { closeTimeout = 5 } = options
  // `sql.end()` of postgres.js 3.4.9 never resolves when a reserved connection is released after it starts (https://github.com/porsager/postgres/issues/1261), so closing counts the connections it must wait for before calling it.
  // Pending `sql.reserve()` calls.
  let acquiring = 0
  // Reserved connections that are not released yet.
  let reserved = 0
  // Connections left reserved because they may be lost or are in an unknown state, which are never released.
  let kept = 0
  let closing: Promise<void> | undefined
  let resumeClosing: (() => void) | undefined
  // Gives up on the pending `acquire` calls while no transaction of the driver holds a connection.
  let stallTimer: ReturnType<typeof setTimeout> | undefined
  let ended = false

  /** Resumes closing once no transaction holds a connection and no `acquire` is pending, or gives the pending ones `closeTimeout` to get a connection. */
  function checkClosing(): void {
    if (!resumeClosing) {
      return
    }
    if (reserved > 0) {
      // A pending `acquire` that got a connection, or waits behind a running transaction, makes progress.
      clearTimeout(stallTimer)
      stallTimer = undefined
    } else if (acquiring === 0) {
      clearTimeout(stallTimer)
      resumeClosing()
      resumeClosing = undefined
    } else {
      // A pending `acquire` may wait behind connections kept reserved or held by other code, which may never return to the pool; a lost connection does return once the pool reconnects it.
      stallTimer ??= setTimeout(() => {
        resumeClosing?.()
        resumeClosing = undefined
      }, closeTimeout * 1000)
    }
  }

  /** Ends the client once the transactions of the driver end. */
  async function endAfterTransactions(): Promise<void> {
    await new Promise<void>(resolve => {
      resumeClosing = resolve
      checkClosing()
    })
    ended = true
    // A connection kept reserved may be alive, so it never ends, and a pending `acquire` may never get a connection; the timeout terminates the connections then and rejects the pending `acquire` calls.
    // The timeout applies to the whole client, so the queries it runs, including those of other code, get the same time to complete.
    await sql.end(kept > 0 || acquiring > 0 ? { timeout: closeTimeout } : undefined)
  }

  async function execute(client: Sql, statement: SqlStatement): Promise<DriverResult> {
    // postgres.js would otherwise serialize parameters and parse results by their types, such as timestamps through Date.
    const parameters = statement.parameters.map(value =>
      value === null ? null : sql.typed(value as never, unknownType),
    )
    const rows = await client.unsafe(statement.text, parameters as never[]).raw()
    return {
      command: rows.command,
      rows: rows.map(row => row.map(value => (value === null ? null : value.toString("utf8")))),
    }
  }

  /**
   * Makes a connection idle after its `BEGIN`, `COMMIT`, or `ROLLBACK` failed with a server error, rolling back the failed transaction if one is open.
   *
   * It rejects with the error of a statement that leaves the connection in an unknown state.
   */
  async function endFailedTransaction(reserved: ReservedSql): Promise<void> {
    // A server error aborts a transaction block, so the connection is idle or in a failed transaction.
    // ROLLBACK is not sent first: outside of a transaction it raises a notice, which postgres.js logs.
    try {
      await reserved.unsafe("SELECT 1")
      return
    } catch (error) {
      if (!isNonFatalServerError(error) || error.code !== errorCodes.in_failed_sql_transaction) {
        throw error
      }
    }
    await reserved.unsafe("ROLLBACK")
  }

  function isNonFatalServerError(error: unknown): error is InstanceType<Sql["PostgresError"]> {
    return (
      error instanceof sql.PostgresError && error.severity !== "FATAL" && error.severity !== "PANIC"
    )
  }

  return {
    execute: statement => execute(sql, statement),
    async acquire() {
      if (closing) {
        throw new Error("Cannot acquire a connection: the driver is closed")
      }
      acquiring++
      let connection: ReservedSql
      try {
        connection = await sql.reserve()
      } catch (error) {
        acquiring--
        checkClosing()
        throw error
      }
      acquiring--
      // postgres.js can still hand a connection to a pending `sql.reserve()` after it ends, such as a lost one it reconnected; no transaction starts on it.
      if (ended) {
        connection.release()
        throw new Error("Cannot acquire a connection: the driver is closed")
      }
      reserved++
      checkClosing()
      return {
        execute: statement => execute(connection, statement),
        async release(failure) {
          let keep = true
          try {
            if (failure) {
              // Any statement or release on a lost reserved connection breaks the pool of postgres.js 3.4.9, so a connection that may be lost stays reserved.
              // A server error other than FATAL and PANIC means the connection is alive.
              if (!isNonFatalServerError(failure.error)) {
                return
              }
              // A failure to make the connection idle leaves it reserved.
              await endFailedTransaction(connection)
            }
            connection.release()
            keep = false
          } finally {
            reserved--
            if (keep) {
              kept++
            }
            checkClosing()
          }
        },
      }
    },
    close() {
      closing ??= endAfterTransactions()
      return closing
    },
  }
}
