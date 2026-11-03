# Transactions

- **Database** (`execution/`): a driver and the ambient transaction coordinator of one connection domain.
  `bind` binds schemas to it, and all schemas bound to the same database share its transactions.
- **Transaction coordinator** (`execution/transaction.ts`): the only place that decides which connection executes a statement or a script of `$script`, which it routes alike.

## Levels

- Nested transactions use savepoints on the transaction connection, and every level run by a callback, the transaction or a savepoint, has its own context; a statement of a finished level fails and never runs in an enclosing level or on the pool.
  A level stops accepting statements before its `COMMIT`, `ROLLBACK`, `RELEASE`, or `ROLLBACK TO`.
- A level has at most one active nested level, reserved before its `SAVEPOINT` is sent, and a level run by a callback rejects its own statements and another nested level while it has one, since PostgreSQL would run them inside the nested savepoint; a test fixture preempts it instead.
- Closing a level closes all levels nested in it at once; a level whose callback settles while its nested level is still active closes it, rolls back, and rejects.
- Every level has a single cleanup: whoever ends it, such as its callback, its enclosing level, a preemption, or the abort signal of a test, starts the cleanup or awaits the one already started.
  A level awaits the cleanup of its nested levels before its own.
- A failed `RELEASE` or `ROLLBACK TO` of a nested level, or a failed restore of its [settings](#settings) before `RELEASE`, makes the enclosing level reject its statements and nested levels and roll back at its end, since the statement may not have reached PostgreSQL.
- Starting a level rejects when its `BEGIN` or `SAVEPOINT` fails, and rolls the level back and rejects when its settings fail.
- A cleanup error of a transaction never replaces an earlier error: it suppresses it in a `SuppressedError`.

## Joining

- `ensureTransaction` of a `Database` and `$ensureTransaction` of a `Db` run their callback in the context of the current level without a savepoint when the code runs in a transaction, and start a transaction otherwise, as `$ensureTransaction` of Orchid ORM 1.78.47 ([docs](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/transactions.md#ensuretransaction)).
  A rejection of a joined callback undoes nothing; the enclosing level commits its changes unless it fails too.
- `isInTransaction` of a `Database` and `$isInTransaction` of a `Db` tell whether the current level or an enclosing one is a level of `transaction`, as `$isInTransaction` of Orchid ORM ([docs](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/transactions.md#isintransaction)).
  A test transaction and the seed of a test fixture are not such levels, so code under test starts a transaction of its own where it does in production, which runs as a savepoint of the test level.
  Orchid ORM ignores a test transaction in `$isInTransaction`.
- Joining a level that accepts no statements, such as of late code of a finished transaction or beside a running nested level, rejects without calling the callback, as starting a nested level does; whether the level accepts statements does not affect `isInTransaction`.

## Locks

- `lock` of a `Database` and `$lock` of a `Db` take `pg_advisory_xact_lock` of `hashtextextended` of a string key with seed `0` on the connection of the current level.
  They reject without a statement where `isInTransaction` is `false`, since a lock taken outside a transaction ends with its statement and one taken in a test transaction would not be held in production.
- PostgreSQL holds the lock until the transaction ends and releases it at `ROLLBACK TO` of a savepoint taken before it, so a nested level that rolls back releases its locks and one that is released keeps them.
- The [migrator](migrations.md#applying-and-rolling-back) locks its target with `lock`.

## Settings

- Settings of a level, such as its search path, are statements on its connection, `set_config(..., true)` after its `BEGIN` or `SAVEPOINT`, completed before its callback starts.
  Scenarios of settings that Orchid ORM failed:
  - settings inside a test transaction were ignored ([orchid-orm#806](https://github.com/romeerez/orchid-orm/pull/806));
  - a setting still in flight at the rollback of a test transaction was restored after it, which left it on the connection for later tests ([orchid-orm#813](https://github.com/romeerez/orchid-orm/pull/813));
  - a callback that rejected before its settings completed crashed Node with an unhandled rejection ([orchid-orm#804](https://github.com/romeerez/orchid-orm/pull/804)).
- `transaction` of a `Database` and `$transaction` of a `Db` take the search path of the level as a list of schemas, which they quote, such as the target schema and the schema of extensions of [migrations](migrations.md#applying-and-rolling-back).
  They take it in options after the callback, as `testTransaction` takes its options.
- A nested level restores the settings it changed when it is released, since PostgreSQL keeps a setting of `SET LOCAL` or `set_config(..., true)` of a released savepoint until the transaction ends.
  It reads their values in a statement of its own before it changes them, since PostgreSQL does not define the order in which it evaluates the expressions of one statement, and restores them before its `RELEASE`.
  `ROLLBACK TO` restores them itself, so a level that rolls back sends no settings after its rollback.

## Lifecycle

- Objects with an explicit lifecycle, such as a database and a test fixture, are async disposable.
- Closing a database closes its test fixtures, including those still opening, and then closes the driver; closing it inside a transaction rejects, since the driver would wait for that transaction forever.
  From the first closing, statements, transactions, and fixtures started outside a transaction reject, so nothing opens after the fixtures close; the levels already running still end, and a repeated closing returns the first one.
