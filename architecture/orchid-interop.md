# Orchid interoperability

`packages/orchid-interop/` is the experimental `@kern-orm/orchid-interop` package for Orchid ORM 1.x (1.78.61 or later) and postgres.js 4.
It relies on implementation details of Orchid that the versions it was tested with, Orchid ORM 1.78.61 and pqb 0.73.50, define; a later release that changes them requires a release of the adapter ([decision](../decisions/transactions/orchid-adapter.md)).
It imports Kern only through public `kern-db` entry points and keeps its version-specific transport, codecs, and Orchid state bridge outside the database and ORM packages.
Its entry point exports only `createOrchidInterop`, `runInOrchidTransaction`, and their types; the driver, the executor, and `createOrchidDb` are internal.
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
It reads the `then` of a query that the callback returns without awaiting it while the `schema` and `log` options of the transaction are in the scope of Orchid, by resolving the result of the callback inside that scope.
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
An [external transaction](transactions.md#external-transactions) of the database runs statements on its `ExternalConnection`, and that of `postgresJsConnection` sends only the text `parameters`, which an `OrchidStatement` leaves empty, so PostgreSQL rejects an Orchid statement with values there for its missing parameters.
The executor rejects a client with result transforms.

Parsers are selected once per result column; SQL null bypasses parsing.
Object rows retain the last repeated name and define `__proto__` as an own data property; arrays retain every position.
Command counts preserve postgres.js's nullable count for DDL and empty SQL.
Database-defined type metadata of both parsers and serializers, of domains and arrays, is initialized at startup, unless `fetch_types` of the connection is `false`, and has no refresh operation.

## External transactions of a native instance

`runInOrchidTransaction` of `orchid-transaction.ts` serves a native Orchid instance of `createDb` or `orchidORM` of `orchid-orm/postgres-js`, which keeps its pool and owns its transactions, unlike `createOrchidInterop`, where Kern owns them and Orchid's `testTransaction` is rejected.
It runs a callback in an [external transaction](transactions.md#external-transactions) of a Kern database over the innermost running scope of Orchid's current transaction, test transactions included, and never runs Orchid's statements, which keep running through Orchid.

- It reads the postgres.js client of that scope from private state that Orchid does not expose: `client` of the `TransactionAdapterClass` that `$getAdapter()` returns in a transaction, which a test transaction wraps in a `TestTransactionAdapter` under `adapter`, once for each instance whose test transaction shares the connection.
  It recognizes the wrapper by `trx` without `client`, and the client by `savepoint`, which only the client of a transaction or a savepoint of postgres.js has, and throws an `Error` that names the tested versions for any other shape, such as of the bridge of `createOrchidInterop`, which has no `client`, or of node-postgres.
  Outside a transaction, where `isInTransaction` of the adapter is `false`, it throws `TypeError`; `$isInTransaction` of the instance is `false` in a test transaction, so it is not used.
  Each instance keeps its transaction in an async storage of its own, also over a shared adapter, so the instance must be the one that started the transaction or the test transaction.
- Orchid replaces `client` while one of its savepoints runs and restores it after, and postgres.js remembers a failed statement on the client that sent it, also the client of an enclosing scope while a savepoint runs, so it reads the client for every statement, and creates the connection of `postgresJsConnection` again only when the client changes, so that a failure in a savepoint of Orchid fails only that savepoint.
- postgres.js rolls back and rejects a scope of `sql.begin` or `sql.savepoint` whose callback resolves after a statement failed on its client, as [drivers](drivers.md#postgresjs) describe, while `begin` of Orchid's postgres.js adapter returns the result of its callback when `sql.begin` rejects after the callback resolved, so `$transaction` resolves and the changes are lost ([comparison](../comparison/transactions.md#a-transaction-that-postgresql-does-not-commit)).
  So it records the first error of a statement that ran on the client of the scope that was current when it was called, and rejects with an `Error` whose `cause` is that error after its callback and `externalTransaction` resolved and the statements sent on the connection settled, since the level stops accepting statements when its callback settles but does not wait for those already sent; a rejection of either keeps its own error.
  A failure on the client of a savepoint of Orchid that started in the callback is not recorded: postgres.js rejects that savepoint, and Orchid rejects its nested `$transaction` by itself.
  When the callback of that `$transaction` resolves before such a statement fails, postgres.js has already ended the scope of the savepoint without a failure on its client, and the statement fails the enclosing scope with no record; recording it would also fail a savepoint that rolled back a failure it awaited, so the callback of a nested `$transaction` of Orchid must await the statements of Kern that it starts.
  The rejection reaches Orchid only through the callback of its transaction: a caller that catches it inside that callback still loses the changes.
  A `COMMIT` that PostgreSQL rejects, such as for a deferred constraint, happens after the call, and `$transaction` resolves then too.
- A statement of Orchid with values does not run on the connection, which sends only the text parameters of Kern, as [execution](#execution-and-codecs) describes; Orchid's public `adapter.query()` is not used as the connection ([decision](../decisions/transactions/external-transactions.md#the-query-executor-of-the-owner-as-the-connection)).

## Tests

The tests of the executor beside its module compare it with the native execution of Orchid; the tests of `getNativeParameters` belong to kern-db.
Acceptance tests in `tests/` use real Orchid tables and Kern queries through the entry point for CRUD, relation reads, nested writes, automatic hook transactions, both transaction entry points, nested rollback, recoverable queries, concurrency, schema scopes of concurrent and nested transactions, the options of a transaction for a query that its callback returns directly, isolation, test levels, late work, transaction control in SQL text, and unsupported features.
The tests of `runInOrchidTransaction` beside its module check its errors with fake adapters, and what a real commit of native Orchid keeps, read from another connection; `tests/external-transaction.test.ts` applies a history of `kern-migrations`, a development dependency, in Orchid's `testTransaction` with a nested test level, a failing migration, and the rollback of the outer level.
The package test installs the packed adapter with the tested versions of its dependencies, emits consumer declarations, and executes shared transactions, and an external transaction of a native instance, under Bun and Node.js.

## Open questions

Remaining hooks, settings, codec refresh, and application acceptance work is tracked in [the interop backlog](../backlog/orchid-transaction-interop.md).
