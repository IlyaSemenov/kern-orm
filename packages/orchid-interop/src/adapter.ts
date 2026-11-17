import type { Database, IsolationLevel } from "kern-db"
import { QueryError } from "kern-db"
import type { Adapter } from "orchid-orm"
import { Adapter as PostgresJsAdapter } from "orchid-orm/postgres-js"
import type { Sql } from "postgres"

import type { AsyncState, AsyncStateStorage, TransactionAdapter } from "./orchid-types"
import { createPostgresJsExecutor } from "./postgres-js"

type AdapterTransactionOptions = NonNullable<Parameters<Adapter["transaction"]>[1]>

/** Rejects a feature whose transaction semantics this adapter cannot preserve. */
export function rejectUnsupported(feature: string): never {
  throw new TypeError(`The Kern Orchid adapter does not support ${feature}`)
}

/** Rejects session settings before a query or transaction can apply only part of them. */
export function assertSessionOptions(options?: Pick<AsyncState, "role" | "setConfig">): void {
  if (options?.role !== undefined || options?.setConfig !== undefined) {
    rejectUnsupported("role or setConfig options")
  }
}

// Sticky keywords of PostgreSQL that match only a whole word: a character that may continue an identifier must not follow.
/** First keyword of a statement that begins or ends a transaction or a savepoint, apart from `PREPARE TRANSACTION`. */
const transactionCommand =
  /(?:abort|begin|commit|end|release|rollback|savepoint|start)(?![\w$\u0080-\uffff])/iy
const prepareKeyword = /prepare(?![\w$\u0080-\uffff])/iy
const transactionKeyword = /transaction(?![\w$\u0080-\uffff])/iy
const asKeyword = /as(?![\w$\u0080-\uffff])/iy

/**
 * Rejects direct transaction and savepoint commands, such as `COMMIT` of `$query`, so that they cannot end a transaction of Kern.
 * The driver runs one statement per text with the extended protocol, and every such statement of PostgreSQL starts with its keywords, so the leading keywords after whitespace, comments, and empty statements recognize it.
 * Statements that change settings, such as `SET TRANSACTION`, are allowed, as decisions/transactions/orchid-transaction-control.md explains.
 */
export function assertNoTransactionControl(text: string): void {
  // PostgreSQL drops empty statements before the one statement that the extended protocol allows.
  let index = skipWhitespaceAndComments(text, 0)
  while (text[index] === ";") index = skipWhitespaceAndComments(text, index + 1)
  if (matchesAt(transactionCommand, text, index) || isPrepareTransaction(text, index)) {
    rejectUnsupported(
      "transaction control statements; use orchid.$transaction or database.transaction",
    )
  }
}

/**
 * Whether the statement at `index` is `PREPARE TRANSACTION`, which a string constant follows.
 * `PREPARE` of a statement named `transaction` is followed by `AS` or the list of its parameter types instead.
 */
function isPrepareTransaction(text: string, index: number): boolean {
  if (!matchesAt(prepareKeyword, text, index)) return false
  index = skipWhitespaceAndComments(text, prepareKeyword.lastIndex)
  if (!matchesAt(transactionKeyword, text, index)) return false
  index = skipWhitespaceAndComments(text, transactionKeyword.lastIndex)
  return text[index] !== "(" && !matchesAt(asKeyword, text, index)
}

/** Whether the sticky `pattern` matches at `index`; on a match, its `lastIndex` is the end of the match. */
function matchesAt(pattern: RegExp, text: string, index: number): boolean {
  pattern.lastIndex = index
  return pattern.test(text)
}

/** Index of the first character at or after `index` outside the whitespace and comments of PostgreSQL, whose block comments nest. */
function skipWhitespaceAndComments(text: string, index: number): number {
  while (index < text.length) {
    const char = text[index]!
    if (
      char === " " ||
      char === "\t" ||
      char === "\n" ||
      char === "\r" ||
      char === "\f" ||
      char === "\v"
    ) {
      index++
    } else if (text.startsWith("--", index)) {
      index += 2
      while (index < text.length && text[index] !== "\n" && text[index] !== "\r") index++
    } else if (text.startsWith("/*", index)) {
      index += 2
      for (let depth = 1; depth > 0 && index < text.length;) {
        if (text.startsWith("/*", index)) {
          depth++
          index += 2
        } else if (text.startsWith("*/", index)) {
          depth--
          index += 2
        } else {
          index++
        }
      }
    } else {
      break
    }
  }
  return index
}

/** Creates Orchid's execution facade; every transaction belongs to the supplied Kern database. */
export function createAdapter(database: Database, client: Sql): TransactionAdapter {
  const executor = createPostgresJsExecutor(database, client)
  const adapter: TransactionAdapter = {
    errorClass: QueryError,
    // Orchid reads this metadata when building columns; none of its native execution methods may run.
    driverAdapter: {
      ...PostgresJsAdapter,
      configure: () => rejectUnsupported("creating another connection pool"),
      borrow: () => rejectUnsupported("borrowing native connections"),
      release: () => rejectUnsupported("releasing native connections"),
      queryClient: () => rejectUnsupported("native query execution"),
      begin: () => rejectUnsupported("native transactions"),
      savepoint: () => rejectUnsupported("native savepoints"),
      hackySavepoint: () => rejectUnsupported("manually controlled savepoints"),
      close: () => rejectUnsupported("closing native connections"),
    },
    isInTransaction(this: Adapter): this is TransactionAdapter {
      return database.isInTransactionBlock()
    },
    assignError(to, from) {
      // Kern retains the native error as cause; Orchid expects its own field names and error class.
      const source = (from.cause ?? from) as Record<string, unknown>
      const target = to as unknown as Record<string, unknown>
      for (const key in PostgresJsAdapter.errorFields) {
        const names = PostgresJsAdapter.errorFields[key]!
        if (typeof names === "string") {
          target[key] = source[names]
        } else {
          for (const name of names) {
            if (source[name] !== undefined) {
              target[key] = source[name]
              break
            }
          }
        }
      }
      to.message = from.message
      to.code = (from as QueryError).code
      to.constraint = (from as QueryError).constraint
    },
    async query(text, values, state) {
      assertSessionOptions(state)
      assertNoTransactionControl(text)
      // pqb types rowCount as number, but its postgres.js adapter returns null for DDL too.
      return (await executor.query(text, values)) as never
    },
    async arrays(text, values, state) {
      assertSessionOptions(state)
      assertNoTransactionControl(text)
      return (await executor.arrays(text, values)) as never
    },
    transaction<T>(
      storage: AsyncStateStorage | undefined,
      options: AdapterTransactionOptions | undefined,
      callback: (adapter: TransactionAdapter) => Promise<T>,
    ) {
      assertSessionOptions(options)
      if (options?.readOnly !== undefined || options?.deferrable !== undefined) {
        rejectUnsupported("readOnly or deferrable transaction options")
      }
      const isolation = options?.level?.toLowerCase()
      if (
        isolation !== undefined &&
        isolation !== "read committed" &&
        isolation !== "repeatable read" &&
        isolation !== "serializable"
      ) {
        rejectUnsupported(`transaction isolation ${options!.level}`)
      }
      return database.transaction(
        () => {
          if (!storage) return callback(adapter)
          const state = storage.getStore()
          return storage.run(
            {
              ...state,
              log: options?.log ?? state?.log,
              schema: options?.schema ?? state?.schema,
            },
            () => callback(adapter),
          )
        },
        { isolation: isolation as IsolationLevel | undefined },
      )
    },
    // The bridge runs recoverable queries in a nested Kern transaction; only recoverable writes of .none(), which bypass the then accessor of the bridge, reach Orchid's savepoints.
    // A savepoint of one callback is a nested Kern transaction; one released by a later statement has no Kern counterpart.
    savepoint: (_name, _log, callback) => database.transaction(callback),
    hackySavepoint: () =>
      rejectUnsupported(
        "recoverable writes of .none() that select relations; run the write without recovery in a transaction of its own and catch the error outside it",
      ),
    close: () => database.close(),
    getDatabase: () => client.options.database ?? adapter.getUser(),
    getUser: () =>
      typeof client.options.user === "string"
        ? client.options.user
        : rejectUnsupported("reading dynamic user metadata"),
    getHost: () => client.options.host.join(","),
    getSearchPath: () => client.options.connection.search_path?.toString(),
    getSchema: () => undefined,
    clone: () =>
      rejectUnsupported("cloning adapters or Orchid testTransaction; use Kern test helpers"),
  }
  return adapter
}
