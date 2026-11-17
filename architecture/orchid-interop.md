# Orchid interoperability

`packages/orchid-interop/` is the experimental `@kern-orm/orchid-interop` package for Orchid ORM 1.x (1.78.61 or later) and postgres.js 4.
It relies on implementation details of Orchid that the versions it was tested with, Orchid ORM 1.78.61 and pqb 0.73.50, define; a later release that changes them requires a release of the adapter ([decision](../decisions/transactions/orchid-adapter.md)).
It imports Kern only through public `kern-db` entry points and keeps its version-specific transport, codecs, and Orchid state bridge outside the database and ORM packages.
Its entry point exports only `createOrchidInterop` and its types; the driver, the executor, and `createOrchidDb` are internal.
It imports Orchid only through the entry points of `orchid-orm`, and derives the types of Orchid's transaction state, which `orchid-orm` does not export, from its `Adapter` in `orchid-types.ts`, so that pqb comes in the version that the installed Orchid ORM requires.

## Setup and ownership

`createOrchidInterop(options, tables)` configures one postgres.js client through Orchid's `PostgresJsAdapter`, initializes its database-defined codecs, creates a Kern database with the postgres.js driver of kern-db over that client, and returns that database and an Orchid instance.
A failed initialization closes the client; when closing fails too, it rejects with a `SuppressedError` whose `error` is the error of closing and `suppressed` the error of the initialization, as [transactions](transactions.md) keep an earlier error.
Closing either returned instance closes the shared database and its pool.
`createOrchidDb` attaches the Orchid instance to the database and the initialized codec client, which must use the driver of `createOrchidPostgresJsDriver` over that client.
It rejects the `db` option of Orchid, which Orchid prefers to the adapter and which would run the queries on the pool of another instance.

`createOrchidPostgresJsDriver` of `postgres-js.ts` creates the postgres.js driver of kern-db with the `getNativeParameters` option, which reads the JavaScript values of an `OrchidStatement` from its module-private `orchidValues` symbol, so that postgres.js serializes them as when Orchid runs the statement ([decision](../decisions/drivers/native-parameters.md), [values](../decisions/drivers/orchid-values.md)).
The text statements of Kern run on it as on the driver without the option.
`Database.execute` passes the statement object to the driver unchanged, as [drivers](drivers.md) require.

## Orchid bridge

`adapter.ts` implements Orchid's `Adapter` with `Database.execute` and `transaction`.
It never borrows a native connection, issues transaction-control SQL, or calls Orchid's native transaction manager.
Its `query` and `arrays` reject direct transaction and savepoint commands, such as `COMMIT` of `$query`, with `TypeError` before it runs, by its leading keywords after whitespace, nested comments, and empty statements, so that it cannot end a transaction of Kern ([decision](../decisions/transactions/orchid-transaction-control.md)).
Statements that change settings of a transaction or a session, such as `SET TRANSACTION`, run as any other statement; changing an isolation level passed to a transaction from SQL text breaks the check of the isolation of a nested transaction, which compares the level that was passed.
The callback transaction API maps supported isolation levels to Kern and rejects unsupported options before the callback.
Kern decides the ownership, lifetime, and nesting of every transaction and savepoint ([decision](../decisions/transactions/orchid-adapter.md)).

`orchid.ts` installs behavior only on the created instance and its query bases; it does not change global Orchid prototypes.
Clones and relation queries inherit their base's bridge.
The instance's async storage retains Orchid logging and schema scopes but projects transaction presence from `isInTransaction` of Kern, so that Orchid starts its automatic transactions in a test transaction as in production.
State that Orchid stores drops the projected transaction, which must not outlive the Kern transaction that it describes.
`ensureTransaction` delegates directly to Kern rather than interpreting the presence of an Orchid options scope as a transaction.
The query `then` accessor captures execution context before thenable assimilation to retain it when Bun invokes the function outside its originating async context.
Its setter keeps the `then` that pqb gives a query of `.none()` as pqb assigns it, since pqb compares that function by identity.
Queries constructed in one context and first executed in another use the latter; this is not transaction stamping at query construction.

Commit hooks reject at table initialization or registration.
A query marked for recovery by `catch`, `catchUniqueError`, or `recoverable` runs as a clone without the mark, in a nested Kern transaction inside a transaction block and directly outside one, so Orchid does not reach its own savepoint protocol.
A recoverable write of `.none()`, such as `.none().orCreate(data).recoverable()`, bypasses the accessor and recovers through `savepoint` of the adapter, which runs its callback in a nested Kern transaction.
The callback is the call of `query` or `arrays` of the adapter, including the decoding of the result by the executor; pqb applies `transform` after the savepoint is released, so a failure of `transform` keeps the row, as in Orchid.
Such a write that selects relations reaches `hackySavepoint`, which a later statement releases, and rejects.
The accessor cannot handle such a query: pqb recognizes it by the identity of its `then`, also while it builds a recoverable query, such as an `orCreate` after `recoverable()`.
The test helper of pqb records pending levels under a private `trxForTest` symbol before calling `transaction`; the bridge detects that record and rejects before its callback installs a fallback or holds a transaction open.
The storage fallback setter also rejects independent fallback state.
Kern's test helpers operate on the shared database and isolate both query layers.

Errors that PostgreSQL returns for the statements of Orchid tables are translated from Kern `QueryError` and its native cause into Orchid error fields; Orchid does not translate those of its queries of SQL text, such as `$query`, which reject with Kern `QueryError`.
Connection and transaction-lifetime errors remain Kern errors.
Local parsing, transform, or hook errors roll back only when they escape the owning callback, including automatic Orchid hook transactions and the nested transaction of a recoverable query.
A value that postgres.js fails to serialize rejects with `ConnectionError`, which prevents commit even if caught, also in a recoverable query.

## Execution and codecs

`createPostgresJsExecutor` passes the values of a compiled Orchid statement to the database in an `OrchidStatement`, and decodes the text result with `options.parsers` of the initialized Orchid-configured client ([decision](../decisions/drivers/orchid-codecs.md)).
The driver of the database must run on the same client, whose serializers postgres.js applies by the parameter types that PostgreSQL resolves on the execution connection, as for Orchid itself.
The executor rejects a client with result transforms.

Parsers are selected once per result column; SQL null bypasses parsing.
Object rows retain the last repeated name and define `__proto__` as an own data property; arrays retain every position.
Command counts preserve postgres.js's nullable count for DDL and empty SQL.
Database-defined type metadata of both parsers and serializers, of domains and arrays, is initialized at startup, unless `fetch_types` of the connection is `false`, and has no refresh operation.

## Tests

The tests of the executor beside its module compare it with the native execution of Orchid; the tests of `getNativeParameters` belong to kern-db.
Acceptance tests in `tests/` use real Orchid tables and Kern queries through the entry point for CRUD, relation reads, nested writes, automatic hook transactions, both transaction entry points, nested rollback, recoverable queries, concurrency, schema scopes of concurrent and nested transactions, isolation, test levels, late work, transaction control in SQL text, and unsupported features.
The package test installs the packed adapter with the tested versions of its dependencies, emits consumer declarations, and executes shared transactions under Bun and Node.js.

## Open questions

Remaining hooks, settings, codec refresh, and application acceptance work is tracked in [the interop backlog](../backlog/orchid-transaction-interop.md).
