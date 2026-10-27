import type { Driver, DriverResult, SqlStatement } from "kern-orm"
import type { ISql, Sql } from "postgres"

/** OID of the PostgreSQL `unknown` pseudo-type; postgres.js sends such parameters as they are, and PostgreSQL infers their types. */
const unknownType = 705

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
    // postgres.js sends a statement without parameters with the simple protocol, which runs several statements of one text; the extended protocol rejects them before running any.
    const rows = await client.unsafe(statement.text, parameters as never[], { simple: false }).raw()
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
    // The simple protocol of PostgreSQL takes several statements in one query, without parameters; `raw` keeps the parsers of the client from reading the ignored results.
    await client.unsafe(text).simple().raw()
  }

  return {
    execute: statement => execute(sql, statement),
    executeScript: text => executeScript(sql, text),
    async acquire() {
      if (closing) {
        throw new Error("Cannot acquire a connection: the driver is closed")
      }
      const connection = await sql.reserve()
      return {
        execute: statement => execute(connection, statement),
        executeScript: text => executeScript(connection, text),
        // postgres.js returns a released connection to the pool once its statements complete and only when it is idle; it closes one in a transaction, and a lost one is already closed.
        release: () => connection.release(),
      }
    },
    close() {
      // `sql.end()` waits for the reserved connections to be released and serves the pending `sql.reserve()` calls first.
      closing ??= sql.end()
      return closing
    },
  }
}
