import type { ISql, Sql } from "postgres"

import type { Driver, DriverResult, SqlStatement } from "../driver"
import { ConnectionError, toDriverError } from "../driver-error"

/** OID of the PostgreSQL `unknown` pseudo-type; postgres.js sends such parameters as they are, and PostgreSQL infers their types. */
const unknownType = 705

/**
 * Codes of the errors that postgres.js 4 gives a statement only before it sends the statement.
 *
 * A statement on the pool waits for a connection that has started, and postgres.js rejects the waiting statements with the error of a failed start.
 * The list has no code that a statement that postgres.js sent can also get:
 *
 * - `CONNECTION_CLOSED` and `CONNECTION_DESTROYED`, which a statement gets when its connection fails;
 * - a SQLSTATE of the server, even of a failed start, such as `3D000` of a missing database: a sent statement gets its own `FATAL` error, and a function can raise one of any code, such as with `plpy.fatal` of PL/Python.
 */
const unsentCodes: ReadonlySet<unknown> = /* @__PURE__ */ new Set([
  // A statement that the pool rejects before it gets a connection.
  "QUEUE_TIMEOUT",
  "CONNECTION_ENDED",
  // A statement that postgres.js refuses to build.
  "MAX_PARAMETERS_EXCEEDED",
  // Failures of the client to open a connection: of the socket and of the start of the session.
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "CONNECT_TIMEOUT",
  "SSL_NOT_SUPPORTED",
  "AUTHENTICATION_INCOMPLETE",
  "AUTH_TYPE_NOT_IMPLEMENTED",
  "SASL_MECHANISM_NOT_SUPPORTED",
  "SASL_NONCE_MISMATCH",
  "SASL_SIGNATURE_MISMATCH",
  "CHANNEL_BINDING_REQUIRED",
])

/** Classifies an error of a statement of postgres.js, which gives the severity in English as `severity`, and the constraint as `constraint_name`. */
function toPostgresJsError(error: unknown) {
  const fields = (error ?? {}) as { severity?: unknown; code?: unknown; constraint_name?: unknown }
  return toDriverError(error, {
    severity: fields.severity,
    code: fields.code,
    constraint: fields.constraint_name,
    unsent: unsentCodes.has(fields.code),
  })
}

/**
 * Creates a kern-db driver over a postgres.js client; the client keeps managing its pool.
 *
 * It throws a `TypeError` for a client that transforms the column names or rows of results, such as with `postgres.camel`.
 * Closing the driver ends the supplied client.
 */
export function postgresJsDriver(sql: Sql): Driver {
  // postgres.js applies these transforms also to the results of `.raw()`, which would rename the result columns that kern-db reads values by, or replace the rows; it skips the transform of values there.
  const { column, row } = sql.options.transform
  if (column.from !== undefined || row.from !== undefined) {
    throw new TypeError(
      "Cannot create a driver of a postgres.js client that transforms the column names or rows of results, such as with postgres.camel: kern-db reads results as PostgreSQL returns them",
    )
  }

  let closing: Promise<void> | undefined

  async function execute(client: ISql, statement: SqlStatement): Promise<DriverResult> {
    // postgres.js would otherwise serialize parameters and parse results by their types, such as timestamps through Date.
    // A parameter of a known type, including `null`, also lets postgres.js prepare and run a statement in one round trip.
    const parameters = statement.parameters.map(value => sql.typed(value as never, unknownType))
    let rows
    try {
      // postgres.js sends a statement without parameters with the simple protocol, which runs several statements of one text; the extended protocol rejects them before running any.
      rows = await client.unsafe(statement.text, parameters as never[], { simple: false }).raw()
    } catch (error) {
      throw toPostgresJsError(error)
    }
    const { columns } = rows
    const names: string[] = []
    for (let index = 0; index < columns.length; index++) {
      names.push(columns[index]!.name)
    }
    return {
      command: rows.command,
      // postgres.js gives `null` for a command tag without a number of rows, such as `BEGIN`.
      count: rows.count ?? 0,
      columns: names,
      rows: rows.map(row => row.map(value => (value === null ? null : value.toString("utf8")))),
    }
  }

  async function executeScript(client: ISql, text: string): Promise<void> {
    try {
      // The simple protocol of PostgreSQL takes several statements in one query, without parameters; `raw` keeps the parsers of the client from reading the ignored results.
      await client.unsafe(text).simple().raw()
    } catch (error) {
      throw toPostgresJsError(error)
    }
  }

  /**
   * Throws once closing starts.
   *
   * `sql.end()` ends the pool only after a few microtasks, and the pool still queues and runs a statement sent before then.
   */
  function assertOpen(operation: string): void {
    if (closing) {
      throw new ConnectionError(`Cannot ${operation}: the driver is closed`, { unsent: true })
    }
  }

  return {
    async execute(statement) {
      assertOpen("execute a statement")
      return execute(sql, statement)
    },
    async executeScript(text) {
      assertOpen("execute a script")
      return executeScript(sql, text)
    },
    async acquire() {
      assertOpen("acquire a connection")
      let connection
      try {
        connection = await sql.reserve()
      } catch (error) {
        // A failure to get a connection leaves no connection to use, whatever its fields, such as of a server that rejects connecting.
        throw toDriverError(error, { unsent: true })
      }
      return {
        execute: statement => execute(connection, statement),
        executeScript: text => executeScript(connection, text),
        // postgres.js returns a released connection to the pool once its statements complete and only when ReadyForQuery reports it idle, and closes one in a transaction.
        // A `ConnectionError` leaves the connection open only for a statement that postgres.js refused without breaking the exchange of messages, such as one with too many parameters, whose status it still reads; a lost connection is already closed.
        release: () => connection.release(),
      }
    },
    close() {
      // `sql.end()` waits for the reserved connections to be released and for the statements already sent, and serves the pending `sql.reserve()` calls first.
      closing ??= sql.end()
      return closing
    },
  }
}
