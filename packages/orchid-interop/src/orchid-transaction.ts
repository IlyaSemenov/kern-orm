// External transactions of kern-db over the current transaction of a native Orchid ORM instance on postgres.js, which Orchid keeps owning.
import type { Database, ExternalConnection } from "kern-db"
import { postgresJsConnection } from "kern-db/postgres-js"
import type { Adapter } from "orchid-orm"
import type { TransactionSql } from "postgres"

/** Orchid ORM instance whose current transaction `runInOrchidTransaction` joins, such as of `createDb` or `orchidORM` of `orchid-orm/postgres-js`. */
export interface OrchidTransactionSource {
  /** Returns the adapter of the current transaction of Orchid, or the adapter of the pool outside one. */
  $getAdapter(): Adapter
}

/** Versions whose private transaction state `readTransactionClient` was tested with. */
const testedVersions = "Orchid ORM 1.78.61 (pqb 0.73.50) on postgres.js 4"

/**
 * Runs `callback` in an external transaction of `database` over the current transaction of the native Orchid ORM instance `orchid` on postgres.js, so that the statements of kern-db in it commit or roll back with that transaction, which Orchid keeps owning.
 *
 * It joins the innermost transaction, savepoint, or test transaction of `orchid` that is running, such as of `$transaction` of an instance of `orchidORM`, `transaction` of an instance of `createDb`, or `testTransaction` of `orchid-orm`; `orchid` must be the instance that started it, such as the one passed to `testTransaction.start`.
 * The statements of `database` run on the postgres.js client of the current scope of Orchid, read for each statement, and those of Orchid in the callback keep running through Orchid.
 * After a statement of `database` failed on the client of the scope that runs the call, that scope can only roll back, also when the callback caught the error or a nested transaction of `database` rolled the statement back: postgres.js then rolls it back when it ends.
 * When the callback of an outermost `$transaction` of Orchid resolves, Orchid resolves that transaction without an error although postgres.js rolled it back.
 * So it rejects after a callback that resolved although such a statement failed, once the statements that the callback sent have settled; a callback that rejects keeps its error.
 * A failed statement in a nested `$transaction` of Orchid that started in the callback rolls back only that nested transaction, which rejects, provided that its callback awaited the statement: a statement that fails after that callback resolved fails the enclosing scope without a rejection.
 * It rejects outside a transaction of Orchid with `TypeError`, and for an instance of `createOrchidInterop`, another driver of Orchid, or a version of Orchid whose private transaction state it does not recognize, with an `Error` that names the tested versions.
 */
export async function runInOrchidTransaction<T>(
  orchid: OrchidTransactionSource,
  database: Database,
  callback: () => PromiseLike<T>,
): Promise<T> {
  const scope = readTransactionClient(orchid)
  let failure: { error: unknown } | undefined
  let currentClient = scope
  let currentConnection = postgresJsConnection(scope)
  /** Statements sent on the connection that have not settled. */
  const pending = new Set<Promise<unknown>>()

  /** Runs `run` on the connection of the current client of Orchid's transaction, and records its failure on the client of the scope. */
  async function runStatement<R>(run: (connection: ExternalConnection) => Promise<R>): Promise<R> {
    // Orchid replaces the client of its transaction while one of its savepoints runs, and postgres.js remembers a failed statement on the client that sent it, so a statement sent on the client of the transaction during a savepoint would fail the transaction after the savepoint rolled it back.
    const client = readTransactionClient(orchid)
    if (client !== currentClient) {
      currentClient = client
      currentConnection = postgresJsConnection(client)
    }
    const result = run(currentConnection)
    pending.add(result)
    try {
      return await result
    } catch (error) {
      // A failure on the client of a savepoint of Orchid that started in the callback is not recorded: when it fails before the callback of the nested `$transaction` resolves, postgres.js rejects that savepoint, and Orchid rejects the nested `$transaction` by itself.
      if (client === scope) failure ??= { error }
      throw error
    } finally {
      pending.delete(result)
    }
  }

  const result = await database.externalTransaction(
    {
      execute: statement => runStatement(connection => connection.execute(statement)),
      executeScript: text => runStatement(connection => connection.executeScript(text)),
    },
    callback,
  )
  // The external transaction stops accepting statements when its callback settles, so no statement joins `pending` after it, but it does not wait for those already sent, such as of a promise that the callback did not await.
  await Promise.allSettled(pending)
  if (failure) {
    throw new Error(
      "runInOrchidTransaction(): a statement failed in the transaction or savepoint of Orchid ORM that runs the call, which can therefore only roll back, also after a nested transaction rolled the statement back",
      { cause: failure.error },
    )
  }
  return result
}

/** Returns the postgres.js client of the innermost scope of the current transaction of Orchid, read from private fields of Orchid that have no public accessor. */
function readTransactionClient(orchid: OrchidTransactionSource): TransactionSql {
  let adapter: unknown = orchid.$getAdapter()
  if (!(adapter as Adapter).isInTransaction()) {
    throw new TypeError(
      "runInOrchidTransaction() must run in a transaction of Orchid ORM, such as in the callback of $transaction or in a test transaction",
    )
  }
  // A test transaction wraps the adapter of its transaction in a `TestTransactionAdapter`, under `adapter`, and the test transaction of each further instance that shares the connection wraps it once more.
  // The adapter of a transaction, `TransactionAdapterClass`, also has `adapter`, the adapter of the pool, and keeps its client in `client`.
  while (isObject(adapter) && !("client" in adapter) && "trx" in adapter) {
    adapter = adapter.adapter
  }
  const client = isObject(adapter) ? adapter.client : undefined
  // A client of postgres.js is a function, its tagged template, and only the client of a transaction or a savepoint has `savepoint`.
  if (
    typeof client !== "function" ||
    typeof (client as Partial<TransactionSql>).savepoint !== "function"
  ) {
    throw new Error(
      `runInOrchidTransaction() did not recognize the postgres.js client in the transaction of Orchid ORM: it requires a native instance of Orchid ORM on postgres.js, not an instance of createOrchidInterop, whose transactions belong to kern-db, and was tested with ${testedVersions}`,
    )
  }
  return client as unknown as TransactionSql
}

/** Tells whether `value` is an object whose properties can be read. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
