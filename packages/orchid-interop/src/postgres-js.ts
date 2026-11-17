import type { Database, Driver, DriverResult, SqlStatement } from "kern-db"
import { postgresJsDriver } from "kern-db/postgres-js"
import type postgres from "postgres"

/** Key of the JavaScript values of the parameters of an Orchid statement, which postgres.js serializes. */
const orchidValues = Symbol("orchidValues")

/** Statement of Orchid, whose parameters are JavaScript values rather than PostgreSQL text; `parameters` stays empty. */
interface OrchidStatement extends SqlStatement {
  readonly [orchidValues]: readonly unknown[]
}

/**
 * Creates a Kern driver over a postgres.js client that runs both the text statements of Kern and the statements of the executor.
 *
 * postgres.js serializes the values of an Orchid statement as when Orchid runs it on the client: by the types that PostgreSQL resolves for its parameters on the connection that runs it.
 * Closing the driver ends the client.
 */
export function createOrchidPostgresJsDriver(client: postgres.Sql): Driver {
  return postgresJsDriver(client, {
    getNativeParameters: statement => (statement as Partial<OrchidStatement>)[orchidValues],
  })
}

/** Orchid postgres.js result fields, including its nullable count for commands without a row count. */
export interface OrchidResult<Row = Record<string, unknown>> {
  readonly rowCount: number | null
  readonly rows: Row[]
  readonly fields: { name: string }[]
}

/** Execution of compiled Orchid statements through a Kern database. */
export interface PostgresJsExecutor {
  /** Returns object rows with Orchid's postgres.js representations. */
  query(text: string, values?: readonly unknown[]): Promise<OrchidResult>
  /** Returns positional rows, preserving repeated column names. */
  arrays(text: string, values?: readonly unknown[]): Promise<OrchidResult<unknown[]>>
}

/**
 * Creates a statement executor that decodes results with the parsers of a configured Orchid postgres.js 4 client.
 *
 * The database must run on the driver of `createOrchidPostgresJsDriver` over the same client.
 * The caller must initialize the client's database-defined types before passing it, and neither resource is closed here.
 */
export function createPostgresJsExecutor(
  database: Database,
  client: postgres.Sql,
): PostgresJsExecutor {
  const { parsers, transform } = client.options
  if (transform.column.from || transform.row.from || transform.value.from) {
    // These callbacks can depend on table/attribute metadata that Kern's result contract does not expose.
    throw new TypeError("The Orchid executor does not support postgres.js result transforms")
  }

  function execute(text: string, values: readonly unknown[] = []): Promise<DriverResult> {
    const statement: OrchidStatement = { text, parameters: [], [orchidValues]: values }
    return database.execute(statement)
  }

  return {
    async query(text, values) {
      return decodeResult(await execute(text, values), parsers, false)
    },
    async arrays(text, values) {
      return decodeResult(await execute(text, values), parsers, true)
    },
  }
}

/** Decodes each column with its OID's parser, preserving SQL null without invoking a parser. */
function decodeResult(
  result: DriverResult,
  registry: postgres.ParsedOptions["parsers"],
  arrays: true,
): OrchidResult<unknown[]>
function decodeResult(
  result: DriverResult,
  registry: postgres.ParsedOptions["parsers"],
  arrays: false,
): OrchidResult
function decodeResult(
  result: DriverResult,
  registry: postgres.ParsedOptions["parsers"],
  arrays: boolean,
): OrchidResult<unknown[] | Record<string, unknown>> {
  const fields: { name: string }[] = []
  const parsers: ((value: string) => unknown)[] = []
  // Resolve codecs once per result, also for empty results, rather than once per cell.
  for (const column of result.columns) {
    fields.push({ name: column.name })
    parsers.push(registry[column.type]!)
  }
  const rows: (unknown[] | Record<string, unknown>)[] = []
  for (const source of result.rows) {
    const row: unknown[] | Record<string, unknown> = arrays ? [] : {}
    for (let index = 0; index < fields.length; index++) {
      const value = source[index]!
      const decoded = value === null ? null : parsers[index]!(value)
      if (arrays) {
        ;(row as unknown[]).push(decoded)
      } else {
        const name = fields[index]!.name
        // A SQL alias must be an own data property, including the inherited __proto__ setter.
        if (name === "__proto__") {
          Object.defineProperty(row, name, {
            value: decoded,
            enumerable: true,
            configurable: true,
            writable: true,
          })
        } else {
          ;(row as Record<string, unknown>)[name] = decoded
        }
      }
    }
    rows.push(row)
  }
  return { rowCount: getRowCount(result), rows, fields }
}

/** Restores postgres.js's null for commands whose PostgreSQL tag has no count; Kern represents it as zero. */
function getRowCount(result: DriverResult): number | null {
  if (result.count !== 0) return result.count
  // PostgreSQL's counted command tags: https://www.postgresql.org/docs/18/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-COMMANDCOMPLETE
  switch (result.command) {
    case "SELECT":
    case "INSERT":
    case "UPDATE":
    case "DELETE":
    case "MERGE":
    case "COPY":
    case "FETCH":
    case "MOVE":
      return 0
    default:
      return null
  }
}
