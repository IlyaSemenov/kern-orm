import { AsyncLocalStorage } from "node:async_hooks"

import type { Database } from "kern-db"
import type { OrchidORM, OrchidORMSetupOptions, OrmTableThunks, Query } from "orchid-orm"
import { orchidORMWithAdapter } from "orchid-orm"
import type { Sql } from "postgres"

import { assertSessionOptions, createAdapter, rejectUnsupported } from "./adapter"
import type { AsyncState, TransactionAdapter } from "./orchid-types"

const commitHooks = [
  "afterCreateCommit",
  "afterUpdateCommit",
  "afterDeleteCommit",
  "afterSaveCommit",
] as const

/**
 * Creates an Orchid instance whose statements and callback transactions run through the supplied Kern database.
 * The postgres.js client must have Orchid's codecs initialized against the same database; it supplies codecs and connection metadata only.
 * Closing the Orchid instance closes the shared Kern database.
 */
export function createOrchidDb<T extends OrmTableThunks, V extends OrmTableThunks = {}>(
  database: Database,
  client: Sql,
  tables: T,
  options: OrchidORMSetupOptions<V> = {},
): OrchidORM<T, V> {
  // Orchid prefers the instance of db to the adapter, and would run the queries on its pool rather than through Kern.
  if ("db" in options) rejectUnsupported("the db option of Orchid")
  const adapter = createAdapter(database, client)
  const orchid = orchidORMWithAdapter({ ...options, adapter }, tables)
  installStorage(orchid.$qb as unknown as Query, database, adapter)
  const bases = new Set<Query>([orchid.$qb as unknown as Query])
  for (const key in tables) bases.add((orchid as unknown as Record<string, Query>)[key]!.baseQuery)
  for (const key in orchid.$views) {
    bases.add((orchid.$views as unknown as Record<string, Query>)[key]!.baseQuery)
  }
  for (const base of bases) installQuery(base, database)
  return orchid
}

/** Projects Kern's current transaction into Orchid without creating another transaction owner. */
function installStorage(query: Query, database: Database, adapter: TransactionAdapter): void {
  const storage = query.internal.asyncStorage
  const getStore = storage.getStore.bind(storage)
  const run = storage.run.bind(storage)
  // No shared mutable hook queue or nesting counter: Kern is authoritative in every async context.
  const transaction: AsyncState = Object.freeze({ transactionAdapter: adapter, transactionId: 0 })
  storage.getStore = () => {
    const state = getStore()
    // A test transaction is not a transaction of the tested code: Orchid starts its automatic transactions in it, as in production.
    if (!database.isInTransaction()) return state
    return state ? { ...state, ...transaction } : transaction
  }
  storage.run = (state, callback) => {
    assertSessionOptions(state)
    // Orchid stores the state that getStore returned; a projected transaction must not outlive the Kern transaction that it describes.
    if (state?.transactionAdapter) {
      state = { ...state }
      delete state.transactionAdapter
      delete state.transactionId
    }
    return run(state, callback)
  }
  // Orchid's test helper installs an independent fallback context, which would bypass Kern's test lifetime.
  Object.defineProperty(storage, "fallback", {
    get: () => undefined,
    set: () => rejectUnsupported("Orchid testTransaction; use Kern test helpers"),
  })
}

/** Installs per-instance behavior inherited by Orchid's cloned and related queries. */
function installQuery(base: Query, database: Database): void {
  for (const hook of commitHooks) {
    if (base.q[hook]?.length) rejectUnsupported(`${hook} hooks`)
    Object.defineProperty(base, hook, { value: () => rejectUnsupported(`${hook} hooks`) })
  }
  Object.defineProperties(base, {
    afterCommit: { value: () => rejectUnsupported("afterCommit hooks") },
    ensureTransaction: {
      value: (callback: () => Promise<unknown>) => database.ensureTransaction(callback),
    },
    isInTransaction: { value: () => database.isInTransaction() },
  })
  const prototype = Object.getPrototypeOf(base)
  const transaction = base.transaction
  Object.defineProperty(base, "transaction", {
    value(this: Query, ...args: Parameters<Query["transaction"]>) {
      // pqb 0.73.50 records pending test levels before calling transaction; reject before its callback installs a fallback or holds a transaction open.
      for (const symbol of Object.getOwnPropertySymbols(this.internal)) {
        if (
          symbol.description === "trxForTest" &&
          (this.internal as unknown as Record<symbol, { levels: unknown[] }>)[symbol]!.levels.length
        ) {
          return new Promise(() =>
            rejectUnsupported("Orchid testTransaction; use Kern test helpers"),
          )
        }
      }
      return transaction.apply(this, args)
    },
  })
  // Capture the context when .then is read: Bun may call the returned thenable from outside its async function's context.
  // Capturing here also lets Kern reject a callback that runs after its transaction has ended.
  Object.defineProperty(base, "then", {
    configurable: true,
    get(this: Query) {
      const query = this
      const then: Query["then"] = Reflect.get(prototype, "then", query)
      const resume = AsyncLocalStorage.snapshot()
      return (resolve?: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
        resume(() =>
          query.q.catch
            ? executeRecoverable(query, database).then(resolve, reject)
            : then.call(query, resolve, reject),
        )
    },
    // pqb gives a query of .none() its own then and compares that function by identity, so the bridge keeps it as pqb assigns it.
    set(this: Query, value: Query["then"]) {
      Object.defineProperty(this, "then", { value })
    },
  })
}

/**
 * Executes a query marked by `.catch()`, `.catchUniqueError()`, or `.recoverable()` so that its failure leaves the enclosing transaction usable.
 * A `ConnectionError` still ends the enclosing transaction, as Kern ends it for every failure of the connection.
 * Orchid wraps such a query in a savepoint of its own; a nested Kern transaction gives every statement of the query the same savepoint without Orchid's native savepoint protocol.
 * Outside a transaction, a failed statement leaves nothing to recover, so the query runs as usual.
 */
function executeRecoverable(query: Query, database: Database): Promise<unknown> {
  const plain = query.clone()
  plain.q.catch = undefined
  // Calling then reads it in the current context, which a returned thenable would not guarantee.
  const execute = () => (plain.then as unknown as () => Promise<unknown>)()
  return database.isInTransactionBlock() ? database.transaction(execute) : execute()
}
