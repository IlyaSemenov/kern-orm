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
