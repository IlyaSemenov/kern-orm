# Transactions

## Ambient transactions

Queries of a `Db` or a `Database` run in the transaction of the current async context, which `db.$transaction()` or `database.transaction()` starts, without a transaction object passed to called functions.

- Drizzle ORM, lacks: only the queries of the `tx` that `transaction` passes to its callback run in the transaction ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/db.ts#L636-L641)), and transactions in `AsyncLocalStorage` were requested in [drizzle-orm#543](https://github.com/drizzle-team/drizzle-orm/issues/543).
- Kysely, lacks: only the queries of the transaction object run in the transaction ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/kysely.ts#L241-L260)).
- Prisma ORM, lacks: only the queries of the `tx` that `$transaction` passes to its callback run in the transaction ([docs](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions#interactive-transactions)), and ambient transactions in `AsyncLocalStorage` were requested in [prisma#17215](https://github.com/prisma/prisma/issues/17215).
- Orchid ORM, same: `$transaction` keeps the transaction in `AsyncLocalStorage`, so every query of `db` in its callback joins it ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/transactions.md#transaction)).

## Joining a transaction

`ensureTransaction` runs its callback in the context of the current level without a savepoint when the code runs in a transaction, and starts a transaction otherwise.

- Orchid ORM, same: `$ensureTransaction` ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/transactions.md#ensuretransaction)).

## A query that a callback returns without awaiting it

A query that the callback of a transaction returns without awaiting it, which sends its statement when its `then` is called, runs in the transaction: the level resolves the result of its callback in its context.
The types of callbacks reject a query returned directly, so only code that types do not check returns one.

- Orchid ORM 1.78.61 (pqb 0.73.50) on postgres.js, fails: an outermost `transaction`, started outside an async state of Orchid, resolves the query outside the async context of the transaction, so the query runs on the pool, such as at `read committed` in a transaction started at `serializable`; a nested `transaction` awaits its callback in the state of the enclosing one ([source](https://github.com/romeerez/orchid-orm/blob/pqb%400.73.50/packages/pqb/src/adapters/adapter.ts#L765-L807)).

## Integrating another query builder

`Database.execute` routes a compiled statement through the ambient transaction coordinator and returns PostgreSQL text values; the other query builder must adapt its parameter encoding and result decoding to that contract.

- Orchid ORM at commit `381b51ffbb85efd6e4defd4170ba79f360f2a9f1`, differs: its `Adapter` accepts parameters as JavaScript values and exposes object and array results, while `TransactionAdapter` also exposes savepoints ([source](https://github.com/romeerez/orchid-orm/blob/381b51ffbb85efd6e4defd4170ba79f360f2a9f1/packages/pqb/src/adapters/adapter.ts)).
  Its query methods consult its async storage for `ensureTransaction`, `isInTransaction`, and `afterCommit`, so replacing statement execution alone does not delegate those behaviors to another coordinator ([source](https://github.com/romeerez/orchid-orm/blob/381b51ffbb85efd6e4defd4170ba79f360f2a9f1/packages/pqb/src/query/basic-features/transaction/transaction.ts)).

## Whether code runs in a transaction

`isInTransaction` tells whether the current level or an enclosing one is a level of `transaction`; a test transaction is no such level, so code under test starts a transaction of its own where it does in production.

- Orchid ORM, same: `$isInTransaction` ignores a test transaction ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/transactions.md#isintransaction)).

## Settings of a transaction

Settings of a level, such as its search path, are statements on its connection, completed before its callback starts, also inside a test transaction.

- Orchid ORM, fails:
  - settings inside a test transaction were ignored ([orchid-orm#806](https://github.com/romeerez/orchid-orm/pull/806));
  - a setting still in flight at the rollback of a test transaction was restored after it, which left it on the connection for later tests ([orchid-orm#813](https://github.com/romeerez/orchid-orm/pull/813));
  - a callback that rejected before its settings completed crashed Node with an unhandled rejection ([orchid-orm#804](https://github.com/romeerez/orchid-orm/pull/804)).

## A nested transaction whose callback throws

A nested transaction whose callback throws, also synchronously, rolls back to its savepoint and keeps the enclosing transaction.

- Orchid ORM, fails: it kept the state of such a nested transaction in its enclosing one after it ended ([orchid-orm#804](https://github.com/romeerez/orchid-orm/pull/804)).

## Adapting existing Orchid queries

@kern-orm/orchid-interop keeps Orchid's query builder and delegates execution and callback transactions to a Kern database.

- Orchid ORM 1.78.60 / pqb 0.73.49, differs: `orchidORMWithAdapter` builds table instances with a supplied `Adapter` and one instance-local `AsyncStateStorage` ([factory](https://github.com/romeerez/orchid-orm/blob/381b51ffbb85efd6e4defd4170ba79f360f2a9f1/packages/orm/src/orm-instance/orm-instance.ts)).
  The published pqb declarations have circular aliases and incompatible duplicated private types across entry points; a strict NodeNext consumer of this version needs `skipLibCheck: true` ([declaration inputs](https://github.com/romeerez/orchid-orm/blob/381b51ffbb85efd6e4defd4170ba79f360f2a9f1/packages/pqb/src/index.ts)).
  Query clones inherit their `baseQuery`, so per-instance methods can be installed on those bases without modifying global prototypes ([clone](https://github.com/romeerez/orchid-orm/blob/381b51ffbb85efd6e4defd4170ba79f360f2a9f1/packages/pqb/src/query/basic-features/clone/clone.ts)).
  `ensureTransaction` treats any async storage state as a transaction, including a state created by `withOptions`; an adapter that delegates transaction ownership must replace that test ([transaction methods](https://github.com/romeerez/orchid-orm/blob/381b51ffbb85efd6e4defd4170ba79f360f2a9f1/packages/pqb/src/query/basic-features/transaction/transaction.ts)).
  Its `catch` and `catchUniqueError` of a query, unlike those of a promise, and its `recoverable` mark the query for recovery: in a transaction, it runs the statements of the query in a savepoint of its own, and outside one it runs them as usual ([then](https://github.com/romeerez/orchid-orm/blob/381b51ffbb85efd6e4defd4170ba79f360f2a9f1/packages/pqb/src/query/then/then.ts)); a nested Kern transaction around the query gives it the same savepoint.
  Its test helper records levels under a private `trxForTest` symbol before calling the query's `transaction`, then installs fallback storage and rewrites adapter methods; rejecting only the fallback assignment is too late for its start promise to reject reliably ([test helper](https://github.com/romeerez/orchid-orm/blob/381b51ffbb85efd6e4defd4170ba79f360f2a9f1/packages/pqb/src/testTransaction.ts)).
- Orchid ORM 1.78.61 / pqb 0.73.50, same: the adapter leaves `$withOptions` as Orchid has it, where `$withOptions({ schema }, () => query)` executes the query in the context of the caller, without the schema, and `$withOptions({ schema }, async () => query)` in the context of the options: `withOptions` is an async function that returns what `run` of the storage returned ([storage](https://github.com/romeerez/orchid-orm/blob/pqb%400.73.50/packages/pqb/src/query/basic-features/storage/storage.ts#L101-L125)).

## Reaching the connection of a transaction

`externalTransaction` of kern-db runs its callback in a transaction of another library on a connection of that transaction, which the library must give, such as the client of postgres.js that `sql.begin` passes to its callback.

- Orchid ORM 1.78.61 / pqb 0.73.50, lacks: `$getAdapter()` returns the adapter of the current transaction ([source](https://github.com/romeerez/orchid-orm/blob/pqb%400.73.50/packages/pqb/src/query/db.ts#L574)), whose `query` and `arrays` take JavaScript values and parse the values of results by their types, and give no command tag.
  The client of postgres.js of the transaction is the private `client` of `TransactionAdapterClass`, which Orchid replaces with the client of a savepoint while the savepoint runs ([source](https://github.com/romeerez/orchid-orm/blob/pqb%400.73.50/packages/pqb/src/adapters/adapter.ts#L503-L511)), and a test transaction wraps that adapter in a `TestTransactionAdapter` under its private `adapter` ([source](https://github.com/romeerez/orchid-orm/blob/pqb%400.73.50/packages/pqb/src/testTransaction.ts#L273-L292)).
  `$isInTransaction()` returns `false` in a test transaction, while `isInTransaction()` of the adapter returns `true`.

## A transaction that PostgreSQL does not commit

`transaction` of kern-db rejects when PostgreSQL does not commit the transaction, such as when it rejects `COMMIT` for a deferred constraint, and commits the changes that its nested transactions did not roll back after a failed statement that a nested transaction rolled back.

- Orchid ORM 1.78.61 / pqb 0.73.50 on postgres.js 4, fails: `begin` of its adapter of postgres.js returns the result of the callback when `sql.begin` rejects after the callback resolved ([source](https://github.com/romeerez/orchid-orm/blob/pqb%400.73.50/packages/pqb/src/adapters/postgres-js.ts#L201-L222)), so `$transaction` resolves and nothing commits when `COMMIT` fails, such as for a deferred unique constraint, and when a statement failed on the client of the transaction, also one that the callback caught or that a savepoint of SQL text rolled back, which postgres.js rolls back and rejects for.
  A statement that fails in a nested `$transaction` before its callback resolves rejects that nested transaction, since its savepoint of `sql.savepoint` rejects, and leaves the enclosing transaction committable; one that fails after the callback resolved, such as one that the callback did not await, aborts the enclosing transaction, which `$transaction` then resolves without committing.

## Round trips for a recoverable query

Kern opens a savepoint for a recoverable Orchid query in a transaction, rolls back to it on error, and releases it after either outcome.

- Orchid ORM 1.78.61 with pqb 0.73.50 and postgres.js 4.0.0, differs.
  `setCatchingSavepoint` marks the start of the scope and `execQuery` uses a driver savepoint, with `hackySavepoint` deferring completion when later statements still need that scope ([query execution](https://unpkg.com/pqb@0.73.50/dist/index.mjs), [adapter](https://unpkg.com/pqb@0.73.50/dist/postgres-js.mjs)).
  postgres.js sends `SAVEPOINT` and sends `ROLLBACK TO` on a failure inside the scope.
  Its successful savepoint scope sends no `RELEASE`, and `find` reports a missing row after the single-statement scope succeeds ([postgres.js](https://unpkg.com/postgres@4.0.0/src/index.js)).
