# Transactions

- **Database** (`execution/`): a driver and the ambient transaction coordinator of one connection domain.
  `bind` binds schemas to it, and all schemas bound to the same database share its transactions.
- **Transaction coordinator** (`execution/transaction.ts`): the only place that decides which connection executes a statement.

## Levels

- Nested transactions use savepoints on the transaction connection, and every level run by a callback, the transaction or a savepoint, has its own context; a statement of a finished level fails and never runs in an enclosing level or on the pool.
  A level stops accepting statements before its `COMMIT`, `ROLLBACK`, `RELEASE`, or `ROLLBACK TO`.
- A level has at most one active nested level, reserved before its `SAVEPOINT` is sent, and a level run by a callback rejects its own statements and another nested level while it has one, since PostgreSQL would run them inside the nested savepoint; a test fixture preempts it instead.
- Closing a level closes all levels nested in it at once; a level whose callback settles while its nested level is still active closes it, rolls back, and rejects.
- Every level has a single cleanup: whoever ends it, such as its callback, its enclosing level, or a preemption, starts the cleanup or awaits the one already started.
  A level awaits the cleanup of its nested levels before its own.
- A failed `RELEASE` or `ROLLBACK TO` of a nested level makes the enclosing level reject its statements and nested levels and roll back at its end, since the statement may not have reached PostgreSQL.
- Starting a level rejects when its `BEGIN` or `SAVEPOINT` fails.
- A cleanup error of a transaction never replaces an earlier error: it suppresses it in a `SuppressedError`.

## Lifecycle

- Objects with an explicit lifecycle, such as a database and a test fixture, are async disposable.
- Closing a database closes its test fixtures, including those still opening, and then closes the driver; closing it inside a transaction rejects, since the driver would wait for that transaction forever.
  From the first closing, statements, transactions, and fixtures started outside a transaction reject, so nothing opens after the fixtures close; the levels already running still end, and a repeated closing returns the first one.

## Decisions

These hold for features that are not implemented yet.

- Settings of a level, such as its role and `set_config`, are statements on its connection, completed before its callback starts.
- After-commit hooks belong to the level that registered them: rolling the level back discards them, releasing it passes them to the enclosing level, and they run after the outermost commit.
