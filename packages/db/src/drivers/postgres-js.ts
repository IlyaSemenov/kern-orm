import type { ISql, ReservedSql, Sql, TransactionSql } from "postgres"

import type { ExternalConnection } from "../database"
import type { Driver, DriverResult, SqlStatement, TextValue } from "../driver"
import { ConnectionError, toDriverError } from "../driver-error"

/** OID of the PostgreSQL `unknown` pseudo-type, which the driver declares for text parameters so that PostgreSQL infers their types. */
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

/** Options of `postgresJsDriver`. */
export interface PostgresJsDriverOptions {
  /**
   * Returns the values of the parameters of a statement that postgres.js serializes itself, or `undefined` to send the text of its `parameters`.
   *
   * postgres.js serializes each value with the serializers of the client, by the type that PostgreSQL resolves for its parameter on the connection that runs the statement, as when the client runs it.
   * A query builder of postgres.js values sets them in a field that it adds to the statement, which `database.execute` passes to the driver as the same object.
   * When postgres.js cannot serialize a value, the statement rejects with `ConnectionError`.
   * When the function throws, the statement rejects with `ConnectionError` whose `unsent` is `true` and whose `cause` is the thrown error.
   */
  getNativeParameters?: (statement: SqlStatement) => readonly unknown[] | undefined
}

/** Returns the values that postgres.js sends for the parameters of a statement. */
type ParameterConversion = (statement: SqlStatement) => readonly unknown[]

/**
 * Creates the conversion of the text parameters of a statement for `sql`.
 *
 * It declares each text parameter with the type `unknown` (OID 705), whose default serializer of postgres.js keeps the text, so that PostgreSQL infers the type of the parameter from the statement.
 * When every parameter, also `null`, has a declared type, postgres.js sends the values with the statement instead of waiting for PostgreSQL to describe its parameters, so the statement runs in one round trip.
 */
function createTextParameterConversion(sql: ISql): ParameterConversion {
  return statement => statement.parameters.map(value => sql.typed(value as never, unknownType))
}

/** Executes `statement` with the parameters of `toParameters` on `client`, a postgres.js client of a pool, a reserved connection, or a transaction, by the contract of a driver. */
async function execute(
  client: ISql,
  statement: SqlStatement,
  toParameters: ParameterConversion,
): Promise<DriverResult> {
  const parameters = toParameters(statement)
  const rows: TextValue[][] = []
  let result
  try {
    // postgres.js sends a statement without parameters with the simple protocol, which runs several statements of one text; the extended protocol rejects them before running any.
    result = await client
      .unsafe(statement.text, parameters as never[], { simple: false })
      // Keeps the values as PostgreSQL returns them, without the parsers of postgres.js by their types, such as of timestamps into Date.
      .raw()
      .forEach(source => {
        // Convert each row on arrival so that the raw buffers do not accumulate alongside the text rows.
        // oxlint-disable-next-line unicorn/no-new-array -- Allocate the known row width once before decoding its columns.
        const row = new Array<TextValue>(source.length)
        for (let index = 0; index < source.length; index++) {
          const value = source[index]!
          row[index] = value === null ? null : value.toString("utf8")
        }
        rows.push(row)
      })
  } catch (error) {
    throw toPostgresJsError(error)
  }
  return {
    command: result.command,
    // postgres.js gives `null` for a command tag without a number of rows, such as `BEGIN`.
    count: result.count ?? 0,
    // The client's metadata already has the public shape; the readonly contract lets it be shared.
    columns: result.columns,
    rows,
  }
}

/** Executes a script of statements without parameters on `client`, as `execute` executes a statement. */
async function executeScript(client: ISql, text: string): Promise<void> {
  try {
    // The simple protocol of PostgreSQL takes several statements in one query, without parameters; `raw` keeps the parsers of the client from reading the ignored results.
    await client.unsafe(text).simple().raw()
  } catch (error) {
    throw toPostgresJsError(error)
  }
}

/**
 * Creates a kern-db driver over a postgres.js client; the client keeps managing its pool.
 *
 * It throws a `TypeError` for a client that transforms the column names or rows of results, such as with `postgres.camel`.
 * Closing the driver ends the supplied client.
 */
export function postgresJsDriver(sql: Sql, options: PostgresJsDriverOptions = {}): Driver {
  // postgres.js applies these transforms also to the results of `.raw()`, which would rename the result columns that kern-db reads values by, or replace the rows; it skips the transform of values there.
  const { column, row } = sql.options.transform
  if (column.from !== undefined || row.from !== undefined) {
    throw new TypeError(
      "Cannot create a driver of a postgres.js client that transforms the column names or rows of results, such as with postgres.camel: kern-db reads results as PostgreSQL returns them",
    )
  }

  const toTextParameters = createTextParameterConversion(sql)
  const { getNativeParameters } = options
  // Chosen once, so that a driver without the option sends text parameters without checking for it on every statement.
  const toParameters = getNativeParameters
    ? (statement: SqlStatement): readonly unknown[] => {
        let native
        try {
          native = getNativeParameters(statement)
        } catch (error) {
          throw new ConnectionError("Could not read the native parameters of the statement", {
            cause: error,
            unsent: true,
          })
        }
        return native ?? toTextParameters(statement)
      }
    : toTextParameters
  let closing: Promise<void> | undefined

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
      return execute(sql, statement, toParameters)
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
        execute: statement => execute(connection, statement, toParameters),
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

/**
 * Creates the connection of an external transaction over the postgres.js client of that transaction, for `database.externalTransaction`: the client that `sql.begin` or `sql.savepoint` passes to its callback, or a reserved connection after its `BEGIN`.
 *
 * Its statements and scripts run on the client as those of a driver without `getNativeParameters` do, so the client keeps the transaction, and the connection sends no `BEGIN`, `COMMIT`, or `ROLLBACK` by itself.
 * It throws a `TypeError` for another client, such as the client of the pool, whose statements would run outside the transaction.
 * The client must come from a client without transforms of the column names or rows of results, such as of `postgres.camel`, which the client of a transaction gives no options to check.
 * postgres.js rolls back a transaction of `sql.begin` or a savepoint of `sql.savepoint`, and rejects, when its callback resolves after a statement on its client failed without having rolled it back itself, also a statement of a nested transaction of the database that rolled back; a reserved connection has no such rule.
 */
export function postgresJsConnection(sql: TransactionSql | ReservedSql): ExternalConnection {
  // Only the client of a transaction has `savepoint`, and only a reserved connection `release`.
  const client = sql as Partial<TransactionSql & ReservedSql> | null | undefined
  if (typeof client?.savepoint !== "function" && typeof client?.release !== "function") {
    throw new TypeError(
      "postgresJsConnection() takes the postgres.js client of a transaction, which sql.begin or sql.savepoint passes to its callback, or a reserved connection on which a transaction has already started: the statements of another client, such as the client of the pool, would run outside the transaction",
    )
  }
  const toParameters = createTextParameterConversion(sql)
  return {
    execute: statement => execute(sql, statement, toParameters),
    executeScript: text => executeScript(sql, text),
  }
}
