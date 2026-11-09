import type { Driver, DriverResult, SqlStatement } from "kern-orm"
import { ConnectionError, toDriverError } from "kern-orm"
import type { ISql, Sql } from "postgres"

/** OID of the PostgreSQL `unknown` pseudo-type; postgres.js sends such parameters as they are, and PostgreSQL infers their types. */
const unknownType = 705

/** Classifies an error of a statement of postgres.js, which gives the severity in English as `severity`, and the constraint as `constraint_name`. */
function toPostgresJsError(error: unknown) {
  const fields = (error ?? {}) as { severity?: unknown; code?: unknown; constraint_name?: unknown }
  return toDriverError(error, {
    severity: fields.severity,
    code: fields.code,
    constraint: fields.constraint_name,
  })
}

/**
 * Creates a kern-orm driver over a postgres.js client; the client keeps managing its pool.
 *
 * Closing the driver ends the supplied client.
 */
export function postgresJsDriver(sql: Sql): Driver {
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
      throw new ConnectionError(`Cannot ${operation}: the driver is closed`)
    }
  }

  return {
    closesReservedConnections: true,
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
        throw toDriverError(error)
      }
      return {
        execute: statement => execute(connection, statement),
        executeScript: text => executeScript(connection, text),
        // postgres.js returns a released connection to the pool once its statements complete and only when it is idle; it closes one in a transaction, and a lost one is already closed.
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
