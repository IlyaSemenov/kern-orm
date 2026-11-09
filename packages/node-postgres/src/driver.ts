import type { Connection, Driver, DriverResult, SqlStatement, TextValue } from "kern-orm"
import { ConnectionError, QueryError, toDriverError } from "kern-orm"
import type { CustomTypesConfig, Pool, PoolClient, QueryArrayConfig } from "pg"

/** Config of a query with its protocol; `pg` reads `queryMode`, though its types omit it. */
interface StatementConfig extends QueryArrayConfig {
  queryMode: "extended"
}

/** Parsers of a query that keep every value as its text, whatever parsers the client has. */
const textTypes = { getTypeParser: () => (value: string) => value } as unknown as CustomTypesConfig

/**
 * Returns why the driver cannot read the values of a client as text, if it cannot.
 *
 * `pg` sets `native` and `binary` on a client, though its types omit them.
 */
function getUnsupportedClientReason(client: PoolClient & { native?: unknown; binary?: boolean }) {
  // The native client ignores `types` of a query, so it parses values.
  if (client.native) {
    return "nodePostgresDriver requires the JavaScript client: create the pool with pg, not pg.native"
  }
  // `binary`, from the options of the pool or `pg.defaults`, requests binary results of the statements of the extended protocol, which a query cannot turn off and whose values would arrive corrupted.
  if (client.binary) {
    return "nodePostgresDriver requires text results: disable binary in the options of the pool and in pg.defaults"
  }
  return undefined
}

/** Listener of the `error` event of a pool or a client, for a connection whose loss needs no handling at the event; an `EventEmitter` throws an `error` event without a listener, which terminates the process. */
function ignoreConnectionError(): void {}

/** Handler of the outcome of a statement that the queue of a connection waits for without reading it. */
function ignoreOutcome(): void {}

/**
 * Classifies an error of a statement of `pg`, which gives the severity only in the language of the server.
 *
 * With translated messages, `toDriverError` tells an error that ends the session by its SQLSTATE.
 */
function toNodePostgresError(error: unknown) {
  const fields = (error ?? {}) as { severity?: unknown; code?: unknown; constraint?: unknown }
  return toDriverError(error, fields)
}

async function execute(client: PoolClient, statement: SqlStatement): Promise<DriverResult> {
  const config: StatementConfig = {
    text: statement.text,
    values: statement.parameters as TextValue[],
    rowMode: "array",
    types: textTypes,
    // `pg` sends a statement without parameters with the simple protocol, which runs several statements of one text; the extended protocol rejects them before running any.
    queryMode: "extended",
  }
  let result
  try {
    result = await client.query<TextValue[]>(config)
  } catch (error) {
    throw toNodePostgresError(error)
  }
  const { fields } = result
  const columns: string[] = []
  for (let index = 0; index < fields.length; index++) {
    columns.push(fields[index]!.name)
  }
  return {
    command: result.command,
    // `pg` gives `null` for a command tag without a number of rows, such as `BEGIN`.
    count: result.rowCount ?? 0,
    columns,
    rows: result.rows,
  }
}

async function executeScript(client: PoolClient, text: string): Promise<void> {
  try {
    // `pg` sends a query without parameters with the simple protocol, which takes several statements in one query; `textTypes` keeps the parsers of the client from reading the ignored results.
    await client.query({ text, rowMode: "array", types: textTypes })
  } catch (error) {
    throw toNodePostgresError(error)
  }
}

/**
 * Creates a kern-orm driver over a node-postgres pool; the pool keeps managing its connections.
 *
 * Closing the driver ends the supplied pool.
 */
export function nodePostgresDriver(pool: Pool): Driver {
  // Statements on the pool and reserved connections that are not returned yet, also while they wait for a connection.
  // `pool.end()` never serves the `pool.connect()` calls waiting for a connection, so closing waits for them before calling it.
  let checkouts = 0
  let drained: PromiseWithResolvers<void> | undefined
  let closing: Promise<void> | undefined

  // The pool emits `error` for an idle connection that breaks, once it has removed the connection.
  pool.on("error", ignoreConnectionError)
  // A client that the pool hands out emits `error` when its connection breaks, also without a running query; the next query on it rejects.
  // The pool emits `acquire` before it removes its own listener of a client and `release` after it restores it, so a client always has a listener, also while the pool verifies it and when the messages that open a connection and report its failure come in one read.
  pool.on("acquire", client => client.on("error", ignoreConnectionError))
  pool.on("release", (_error, client) => client.off("error", ignoreConnectionError))

  function endCheckout(): void {
    if (--checkouts === 0) {
      drained?.resolve()
    }
  }

  /** Gets a client from the pool for `operation`, which names it in the error once closing starts. */
  async function checkOut(operation: string): Promise<PoolClient> {
    if (closing) {
      throw new ConnectionError(`Cannot ${operation}: the driver is closed`)
    }
    checkouts++
    try {
      const client = await pool.connect()
      const unsupported = getUnsupportedClientReason(client)
      if (unsupported) {
        client.release()
        throw new ConnectionError(unsupported)
      }
      return client
    } catch (error) {
      endCheckout()
      // A failure to get a connection leaves no connection to use, whatever its fields, such as a translated `FATAL` of a server that rejects connecting.
      throw toDriverError(error)
    }
  }

  /** Returns a client to the pool, which closes it with `destroy` or when its connection is lost. */
  function checkIn(client: PoolClient, destroy: boolean): void {
    client.release(destroy)
    endCheckout()
  }

  /** Runs a statement or a script on a client of its own, unlike `pool.query`, which closes the connection of any failed statement. */
  async function runOnPool<T>(
    operation: string,
    run: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await checkOut(operation)
    let destroy = false
    try {
      return await run(client)
    } catch (error) {
      // After another failure, such as `query_timeout`, the statement may still run, or the connection is closing.
      destroy = !(error instanceof QueryError)
      throw error
    } finally {
      checkIn(client, destroy)
    }
  }

  async function endPool(): Promise<void> {
    if (checkouts > 0) {
      drained = Promise.withResolvers()
      await drained.promise
    }
    await pool.end()
  }

  return {
    closesReservedConnections: true,
    execute: statement => runOnPool("execute a statement", client => execute(client, statement)),
    executeScript: text => runOnPool("execute a script", client => executeScript(client, text)),
    async acquire(): Promise<Connection> {
      const client = await checkOut("acquire a connection")
      let last: Promise<void> = Promise.resolve()

      // `pg` deprecates calling `client.query` while a query runs, and removes it in its next major version, so a connection runs its statements one at a time by itself.
      function enqueue<T>(run: () => Promise<T>): Promise<T> {
        const result = last.then(run)
        // The queue keeps only the end of a statement, so that it does not hold the rows of the last one while a transaction goes on.
        last = result.then(ignoreOutcome, ignoreOutcome)
        return result
      }

      return {
        execute: statement => enqueue(() => execute(client, statement)),
        executeScript: text => enqueue(() => executeScript(client, text)),
        // A failed `BEGIN`, `COMMIT`, or `ROLLBACK` may leave a transaction open, so its connection closes instead of returning to the pool.
        release: failure => checkIn(client, failure !== undefined),
      }
    },
    close() {
      closing ??= endPool()
      return closing
    },
  }
}
