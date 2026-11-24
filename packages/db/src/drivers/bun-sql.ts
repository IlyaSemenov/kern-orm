import type { ReservedSQL, SQL } from "bun"

import type { Connection, Driver, DriverResult, SqlStatement, TextValue } from "../driver"
import { ConnectionError, QueryError, toDriverError } from "../driver-error"

/** Classifies Bun's server errors, which carry the PostgreSQL SQLSTATE in errno. */
function toBunError(error: unknown) {
  const fields = (error ?? {}) as Partial<SQL.PostgresError>
  return toDriverError(error, {
    severity: fields.severity,
    code: fields.errno,
    constraint: fields.constraint,
  })
}

async function execute(client: ReservedSQL, statement: SqlStatement): Promise<DriverResult> {
  // Embedding a parameterless unsafe fragment in a tagged query forces the extended protocol to reject multiple commands.
  const query = statement.parameters.length
    ? client.unsafe<(Buffer | null)[][]>(statement.text, statement.parameters as TextValue[])
    : client<(Buffer | null)[][]>`${client.unsafe(statement.text)}`
  const result = await query.raw()
  const rows: TextValue[][] = []
  for (const row of result) {
    // Bun owns these fresh row arrays; replace the buffers in place and omit Bun's metadata on the outer array.
    const decoded = row as (Buffer | TextValue)[]
    for (let index = 0; index < row.length; index++) {
      const value = row[index]!
      if (value !== null) decoded[index] = value.toString("utf8")
    }
    rows.push(decoded as TextValue[])
  }
  return { command: result.command, count: result.count, columns: result.columns!, rows }
}

function startsTransaction(command: string | null): boolean {
  return command === "BEGIN" || command === "START TRANSACTION"
}

function openTransactionError(operation: string): ConnectionError {
  return new ConnectionError(
    `Cannot ${operation} that leaves a transaction open on a pooled connection: the driver closed the connection to roll the transaction back; use $transaction of a Db or transaction of the database instead`,
  )
}

/** Rejects a successful pooled script if a savepoint probe finds its transaction block still open. */
async function checkScriptTransaction(client: ReservedSQL): Promise<void> {
  // COMMIT and COMMIT AND CHAIN have the same tag; ask PostgreSQL whether a block remains on this reservation.
  try {
    await client`SAVEPOINT kern_pool_probe`
  } catch (error) {
    if ((error as SQL.PostgresError).errno === "25P01") return
    throw error
  }
  throw openTransactionError("execute a script")
}

/**
 * Creates a kern-db driver over a Bun SQL PostgreSQL pool with `prepare: false`, which keeps every result column in PostgreSQL text format.
 * Requires Bun 1.4.4 or newer.
 * Throws a `TypeError` for an unsupported runtime, a reserved or transaction client, or a pool with an incompatible adapter, prepared statements, or a transform that renames result columns.
 * Closing the driver closes the pool.
 */
export function bunSqlDriver(sql: SQL): Driver {
  if (typeof Bun === "undefined" || !Bun.semver.satisfies(Bun.version, ">=1.4.4")) {
    throw new TypeError("bunSqlDriver requires Bun 1.4.4 or newer")
  }
  if ("release" in sql || "savepoint" in sql) {
    throw new TypeError(
      "bunSqlDriver requires the client created by new SQL(); reserved connections and transaction clients have a narrower scope",
    )
  }
  if (sql.options.adapter !== "postgres" || sql.options.prepare !== false) {
    throw new TypeError("bunSqlDriver requires a Bun SQL PostgreSQL pool with prepare: false")
  }
  // Bun applies column.from to result metadata even in raw mode.
  // SQL.options exposes the normalized configuration even when the constructor received a preset.
  const transform = sql.options.transform as { column: { from?: unknown } } | undefined
  if (transform?.column.from) {
    throw new TypeError(
      "bunSqlDriver requires a client without a result column name transform such as SQL.camel",
    )
  }
  let checkouts = 0
  let drained: PromiseWithResolvers<void> | undefined
  let closing: Promise<void> | undefined

  function endCheckout() {
    if (--checkouts === 0) drained?.resolve()
  }

  async function reserve(operation: string) {
    if (closing)
      throw new ConnectionError(`Cannot ${operation}: the driver is closed`, { unsent: true })
    // Count waiters too, so closing cannot cancel a reservation already requested.
    checkouts++
    try {
      return await sql.reserve()
    } catch (error) {
      endCheckout()
      throw toDriverError(error, { unsent: true })
    }
  }

  async function release(client: ReservedSQL, broken: boolean) {
    try {
      // Bun checks ReadyForQuery on release and discards an open or failed transaction.
      if (broken) await client.close()
      else await client.release()
    } catch (cause) {
      throw toDriverError(cause)
    } finally {
      endCheckout()
    }
  }

  async function runOnPool<T>(
    operation: string,
    run: (client: ReservedSQL) => Promise<T>,
  ): Promise<T> {
    const client = await reserve(operation)
    let result: T
    try {
      result = await run(client)
    } catch (cause) {
      const error = toBunError(cause)
      // The caller needs the original query diagnostics even if returning the connection also fails.
      await release(client, error instanceof ConnectionError).catch(() => {})
      throw error
    }
    await release(client, false)
    return result
  }

  async function closePool() {
    if (checkouts) {
      drained = Promise.withResolvers()
      await drained.promise
    }
    await sql.close()
  }

  return {
    execute: statement =>
      runOnPool("execute a statement", async client => {
        const result = await execute(client, statement)
        if (startsTransaction(result.command)) throw openTransactionError("execute a statement")
        return result
      }),
    executeScript: text =>
      runOnPool("execute a script", async client => {
        const result = await client.unsafe<SQL.ResultMetadata[]>(text).simple().raw()
        // Bun puts command metadata on each inner result of a multi-statement script.
        if (
          result.command === undefined
            ? result.some((part: SQL.ResultMetadata) => startsTransaction(part.command))
            : startsTransaction(result.command)
        ) {
          await checkScriptTransaction(client)
        }
      }),
    async acquire(): Promise<Connection> {
      const client = await reserve("acquire a connection")
      let last = Promise.resolve()
      let released: Promise<void> | undefined
      let broken = false

      function enqueue<T>(operation: string, run: () => Promise<T>) {
        if (released)
          return Promise.reject(
            new ConnectionError(`Cannot ${operation}: the connection is released`, {
              unsent: true,
            }),
          )
        const result = last
          .then(() => {
            if (broken)
              throw new ConnectionError(
                `Cannot ${operation}: an earlier failure left the connection unusable`,
                { unsent: true },
              )
            return run()
          })
          .catch((cause: unknown) => {
            const error = toBunError(cause)
            broken ||= !(error instanceof QueryError)
            throw error
          })
        // Keep the completion of the last query without holding its result for the rest of the transaction.
        last = result.then(
          () => {},
          () => {},
        )
        return result
      }
      return {
        execute: statement => enqueue("execute a statement", () => execute(client, statement)),
        executeScript: text =>
          enqueue("execute a script", async () => {
            await client.unsafe(text).simple().raw()
          }),
        release() {
          return (released ??= last.then(() => release(client, broken)))
        },
      }
    },
    close: () => (closing ??= closePool()),
  }
}
