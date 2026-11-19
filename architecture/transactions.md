# Transactions

- **Database** (`database.ts`): a driver and the ambient transaction coordinator of one connection domain.
  `bindSchema` binds schemas to it, and all schemas bound to the same database share its transactions.
  It does not expose its coordinator, so that its type does not depend on the private members of a class of one copy of the module: `getCoordinator` finds the coordinator by the object of the database for the test helpers and the driver contract, and finds none for another object, such as a copy of a database.
  `isDatabase` recognizes a database of `createDatabase` of any copy of kern-db by a brand of `Symbol.for`, which `createDatabase` sets as a property that is not enumerable, so it rejects a copy of a database ([decision](../decisions/drivers/recognizing-drivers-and-databases.md)).
- **Transaction coordinator** (`transaction/coordinator.ts`): the only place that decides which connection executes a statement or a script of `$script`, which it routes alike.
- **Transaction level** (`transaction/level.ts`): a transaction or a savepoint nested in it, how it starts, runs its callback, and ends, and how its cleanup errors combine; its [settings](#settings) are in `transaction/settings.ts`.
- **Session** (`transaction/session.ts`): a level that runs statements on a reserved connection outside a transaction, how it starts, the [open sessions](#open-sessions) that the callbacks of `run` share, and how its connection returns to the pool without its [settings](#sessions) and [advisory locks](#locks).
- **Advisory locks** (`transaction/advisory-lock.ts`): the statements of [locks](#locks) of string keys, and the locks that a session holds until it ends.

## Levels

- Nested transactions use savepoints on the transaction connection, and every level run by a callback, the transaction or a savepoint, has its own context; a statement of a finished level fails and never runs in an enclosing level or on the pool.
  A level stops accepting statements before its `COMMIT`, `ROLLBACK`, `RELEASE`, or `ROLLBACK TO`.
- A level has at most one active nested level, reserved before its `SAVEPOINT` is sent, and a level run by a callback rejects its own statements and another nested level while it has one, since PostgreSQL would run them inside the nested savepoint; a test fixture preempts it instead.
- A [level of the test helpers](testing.md#test-transactions) that code runs in makes its statements and nested levels take turns instead of rejecting them while it has a nested level: each one waits until those that came before it end, and once the level ends, the waiters reject at once.
- Closing a level closes all levels nested in it at once; a level whose callback settles while its nested level is still active closes it, rolls back, and rejects, except that a [level of the test helpers](testing.md#test-transactions) whose callback resolves waits for it.
- Every level has a single cleanup: whoever ends it, such as its callback, its enclosing level, a preemption, or the abort signal of a test, starts the cleanup or awaits the one already started.
  A level awaits the cleanup of its nested levels before its own.
- A failed `RELEASE` or `ROLLBACK TO` of a nested level, or a failed restore of its [settings](#settings) before `RELEASE`, makes the enclosing level reject its statements and nested levels and roll back at its end, since the statement may not have reached PostgreSQL.
- Starting a level rejects when its `BEGIN` or `SAVEPOINT` fails, and rolls the level back and rejects when its settings fail.
- A cleanup error of a transaction never replaces an earlier error: it suppresses it in a `SuppressedError`.
- A failed release of the connection of a transaction, a test transaction, or a test fixture never changes the result or error of the call, which is decided before the release: a committed transaction that rejected would be retried.
  `transaction/release.ts` passes the failure to `onReleaseError` of the database, or to `console.error` without one or when the handler throws or rejects.

## Connection failures

- A transaction of `transaction`, also of `ensureTransaction` outside a transaction, watches every statement and script on its connection, including those of its nested levels ([decision](../decisions/transactions/connection-failure-phase.md)); a `ConnectionError` of another connection, such as of the pool of another database, does not count.
- After a `ConnectionError` on it before `COMMIT` is sent, also of a statement that the callback did not await, the transaction rolls back instead of `COMMIT`, also when the callback caught the error and resolved, since the statement may not have run; a statement that succeeds later changes nothing.
- Such a transaction rejects with `TransactionConnectionError`, a `ConnectionError` of the phase of the transaction when the rejection of the first `ConnectionError` came:
  - `begin` before the callback, at getting the connection, `BEGIN`, the settings, or their rollback, so the transaction applied nothing;
  - `transaction` from the callback until `COMMIT` is sent, including the rollback, so the transaction was not committed;
  - `commit` once `COMMIT` is sent, so whether the transaction was committed is unknown: a client that pipelines statements may have sent `COMMIT` before the connection broke, and then rejects every statement it queued, also one sent before `COMMIT`.
- Its `cause` is the error that the transaction rejects with otherwise, by the rules of [levels](#levels): the error of the callback, a `SuppressedError` of a failed cleanup, or the `ConnectionError` itself.
- It recognizes an instance of another copy of `kern-db` by a brand of its own, as the [errors of drivers](drivers.md#errors) do, since `instanceof ConnectionError` would recognize the error but not the subclass.
- A transaction that resolves stays resolved: a statement that the callback did not await, refused by the client with `ConnectionError` without breaking the connection after `COMMIT` was sent, does not stop a `COMMIT` that succeeds.
- A test transaction, a test fixture, and a nested level do not wrap their errors, so a transaction of code under test, which runs as a savepoint of a test level, rejects with the errors of its statements.
- `isOutcomeUnknown` classifies an operation's outcome as unknown after a `TransactionConnectionError` of phase `commit`, and after another `ConnectionError` whose `unsent` is not `true`, of a statement outside a transaction.
  A `ConnectionError` whose `unsent` is `true`, such as of a failure to get a connection, counts as known, as does an error of the database itself before it sends a statement, which is a plain `Error`; a `ConnectionError` of a copy of kern-db without `unsent` counts as unknown.
  `false` does not mean that the operation applied nothing, such as after a `ResultDecodeError`.
  It classifies the error of a whole operation, not one that the callback of a transaction caught.

## Joining

- `ensureTransaction` of a `Database` and `$ensureTransaction` of a `Db` run their callback in the context of the current level without a savepoint when the code runs in a transaction, and start a transaction otherwise.
  A rejection of a joined callback undoes nothing; the enclosing level commits its changes unless it fails too.
- `isInTransaction` of a `Database` and `$isInTransaction` of a `Db` tell whether the current level or an enclosing one is a level of `transaction`.
  A test transaction and the seed of a test fixture are not such levels, so code under test starts a transaction of its own where it does in production, which runs as a savepoint of the test level.
- Joining a level that accepts no statements, such as of late code of a finished transaction or beside a running nested level, rejects without calling the callback, as starting a nested level does; whether the level accepts statements does not affect `isInTransaction`.

## Sessions

- `session` of a `Database` and `$session` of a `Db` run their callback in a session: a level on a reserved connection outside a transaction, for statements that PostgreSQL rejects in a transaction block, such as `CREATE INDEX CONCURRENTLY`, when they need the state of one connection, such as its search path ([decision](../decisions/transactions/sessions.md)).
  One such statement that needs no such state runs on the pool.
  A statement or a script of the callback runs on that connection in a transaction of its own, so a rejection of the callback undoes nothing.
- `transaction` in a session starts a transaction on the connection of the session, with `BEGIN` and `COMMIT` rather than a savepoint, at the isolation level of its options, and rejects with `TransactionConnectionError` as a transaction on a connection of its own does; the levels nested in it are savepoints.
  It is the nested level of the session by the rules of [levels](#levels): the session rejects its own statements while it runs, and a session whose callback settles while it is still active ends it and rejects.
  Such a transaction rolls back, unless its own end has started, such as its `COMMIT`, which the session then awaits.
- A session whose transaction fails to end keeps accepting statements, unless its connection failed: PostgreSQL has ended a transaction whose `COMMIT` it rejected, such as for a deferred constraint.
- A statement of a finished session fails and never runs on the pool.
- `session` rejects without calling its callback:
  - inside a transaction, a test transaction, or the seed of a test fixture, where its statements would run in a transaction block;
  - inside another session;
  - on a database created with `test: true`, whose statements all run in test transactions.
- `isInTransactionBlock` of a `Database` and `$isInTransactionBlock` of a `Db` tell whether a statement of the current context runs in a transaction block of PostgreSQL: in a transaction, a test transaction, or the seed of a test fixture, and not in a session outside its transactions.
  Unlike `isInTransaction`, it counts the levels of the test helpers, since PostgreSQL rejects such a statement in any transaction block; code that has one checks it to choose what to run.
- A session takes the search path of its statements as `transaction` does.
  It sets the search path for the session of PostgreSQL, with `set_config(..., false)`, since it has no transaction that would end the setting, after it reads the value it replaces, and restores that value before its connection returns to the driver.
- After a `ConnectionError` of a statement or a script on its connection, also of its transactions, a session rejects its later statements and transactions: the connection may be lost, and a statement that ran on a new one would run without the settings of the session.
  A [driver](drivers.md) rejects every statement on a reserved connection that is lost.
- A connection whose settings fail to restore, or whose [advisory locks](#locks) fail to release, must not return to the pool with them, and `release` of a connection takes no argument ([decision](../decisions/drivers/release-by-driver.md)), so the session leaves it in a transaction, which a driver closes on release.
  - It sends `BEGIN`, again while PostgreSQL rejects it with a `QueryError` that may leave the connection idle, such as when a cancel request hits the statement, and releases the connection only after that.
  - A `BEGIN` that completes, one that a failed transaction rejects, and one that rejects with `ConnectionError` end it, since a driver closes each such connection on release.
  - A client that refuses, without sending them, both the statement that releases the locks or restores the settings and `BEGIN` keeps an idle connection, which returns to the pool with them: kern-db cannot tell such a `ConnectionError` from a lost connection, on which sending `BEGIN` again would never end.
  - The failure does not change the result or the error of the session, and goes to the handler of [failed releases](#levels) unless it is a `ConnectionError`, which a lost connection gives, with nothing to restore.

## Open sessions

- `openSession` of a `Database` opens a [session](#sessions) that no callback bounds, such as one that holds a lock for as long as a process works: the callbacks of its `run` share it until it is closed, with `close` or by its disposal ([decision](../decisions/transactions/open-sessions.md)).
  It takes the options of `session`, rejects where `session` rejects, and resolves once its settings are set.
  It reads its options before it acquires its connection, so that options that throw reserve none.
- `run` runs its callback in the context of the session, from any async context and any number of times, so its statements, transactions, and locks follow the rules of the callback of `session`.
  It rejects without calling its callback:
  - when the session accepts no statements, as [joining](#joining) a level does: once it is closed, beside a transaction of the session that is running, and after a `ConnectionError` on its connection;
  - inside a transaction, also of the session, and inside another session, whose level the statements of the callback would leave.
- Each call of `run` that the session admits is running until the promise that it returned settles, also a call nested in a callback that did not await it.
  The async context of a callback carries the calls of each open session, also of the sessions of other databases: the innermost one, which tells a running callback from late code of one that settled, and those around it that were running when the innermost call of the context started, inside which closing must not wait.
  It carries no other call that settled, so that a session that runs for long does not keep them.
- Closing waits for the calls that are running and then ends the session ([decision](../decisions/transactions/open-sessions.md)).
  - While it waits, the session is open: the running callbacks go on by the rules of the session, also after a `ConnectionError`, which rejects their later statements, and a transaction that is running keeps its contract.
  - While it waits, `run` rejects, unless a running callback calls it, whose nested call the closing waits for too.
    Late code of a callback that settled cannot start a call then, but its statements sent without `run`, such as with `execute` of the database, still reach the session, whose level its async context keeps, until the session ends.
  - The session ends in the turn in which the last call settles, or in which the closing is called when none is running, so that nothing runs in it in between: a transaction of the session that no callback awaited ends as in a session whose callback settles, and later statements reject.
  - It then waits for the statements and scripts already sent before it releases the locks, restores the settings, and releases the connection: the session counts those that are running, since `release` of a [driver](drivers.md) may return before they complete, as that of postgres.js does.
- A callback must settle for the session to close, so a wait in it must have an end, such as a signal of `pollLock`, and code that a callback waits for must not wait for the closing.
  Until the session closes, it keeps its connection, with the locks that the connection holds while it lives, and the closing of the database waits for it.
- Closing must be called outside the callbacks of `run`: in an async context that a running call of the session encloses, also around a nested call that settled or a callback of another session, it rejects without closing, since it would wait for that call.
  Late code of a callback that settled, outside a running call, closes the session.
- Otherwise closing never rejects, so that it can run in the handling of an error and in a disposal, and a repeated closing returns the first one.
  A failure to end a transaction of the session rejects that transaction, and a failure to release the locks, to restore the settings, or to release the connection goes where it goes at the end of a [session](#sessions).
- A lock that the session holds answers a later `tryLock` without a statement, by the rules of its [locks](#locks), so code that relies on the lock while its connection may be lost must run a statement in the session to learn of the loss.
- An open session must be closed before its database: the closing of the database waits for it, as for a running session, rather than ending it, which would release its locks while the work that they guard still runs.

## Locks

- `lock` of a `Database` and `$lock` of a `Db` take `pg_advisory_xact_lock` of `hashtextextended` of a string key with seed `0` on the connection of the current level, and `tryLock` and `$tryLock` take `pg_try_advisory_xact_lock` of the same key and resolve with whether they took it.
  They reject without a statement where `isInTransaction` is `false`, since a lock taken outside a transaction ends with its statement and one taken in a test transaction would not be held in production; `tryLock` takes a lock of the session in a [session](#sessions) outside its transactions instead.
- PostgreSQL holds the lock until the transaction ends and releases it at `ROLLBACK TO` of a savepoint taken before it, so a nested level that rolls back releases its locks and one that is released keeps them.
- In a session outside its transactions, `tryLock` takes `pg_try_advisory_lock` of the key, which PostgreSQL holds until the session of PostgreSQL ends, or until `pg_advisory_unlock` releases it as many times as it was taken.
  - The session records the attempt of each key that it holds or is taking, and returns it to a later `tryLock` of the key without a statement, so that it takes each lock once.
  - Before it restores its settings, the session awaits the attempts still running and releases its locks with `pg_advisory_unlock` of each key rather than `pg_advisory_unlock_all`, so that it leaves the locks that the SQL of its callback took.
    It releases them in one statement, in a row of each key of an array parameter, since PostgreSQL limits the columns of a result to 1664.
  - After a failed statement of `tryLock`, the session leaves its connection in a transaction instead, as after a failed release: PostgreSQL keeps a lock of a session that it took before the statement failed, so the connection may hold a lock that the session does not know of.
- `lock` rejects in a session outside its transactions too, since a statement that waits for a lock keeps a snapshot, which `CREATE INDEX CONCURRENTLY` in the session that holds the lock waits for.
- `pollLock` of a `Database` and `$pollLock` of a `Db` wait for the lock of a session instead: they call `tryLock` until it takes the lock, after a pause of 50 ms that doubles after each attempt up to 1 s, without a limit of time.
  - They reject without a statement outside a session, and in a transaction, which would keep a snapshot between the attempts, and where `lock` waits.
  - The waiters form no queue, so one of them can miss the lock while others take it.
  - Once their signal aborts, they make no more attempts and reject with its reason, at once during a pause; an attempt that runs when the signal aborts is awaited, and if it takes the lock, they resolve, since the session holds the lock until it ends.
- The [migrator](migrations.md#applying-and-rolling-back) locks its target with `lock` in a transaction block, and with `pollLock` in a session of its own outside one.
- A query that locks rows rejects under the same condition, as its [row locks](queries.md#row-locks) describe.

## Settings

- Settings of a level, such as its search path, are statements on its connection, `set_config(..., true)` after its `BEGIN` or `SAVEPOINT`, completed before its callback starts.
- `transaction` of a `Database` and `$transaction` of a `Db` take the search path of the level as a list of schemas, which they quote, such as the target schema and the schema of extensions of [migrations](migrations.md#applying-and-rolling-back).
  They take it in options after the callback, as `testTransaction` takes its options.
- A nested level restores the settings it changed when it is released, since PostgreSQL keeps a setting of `SET LOCAL` or `set_config(..., true)` of a released savepoint until the transaction ends.
  It reads their values in a statement of its own before it changes them, since PostgreSQL does not define the order in which it evaluates the expressions of one statement, and restores them before its `RELEASE`.
  `ROLLBACK TO` restores them itself, so a level that rolls back sends no settings after its rollback.

## Isolation

- A transaction, a test transaction, or a test fixture that is not nested runs at the isolation level of its options.
- A nested level runs at the isolation level of its transaction, which PostgreSQL sets for the whole transaction, and one whose options give another level rejects without starting.
  It compares the level of the options of its transaction when they give one, and otherwise reads it from the connection once per transaction, so SQL that changes the level of a transaction started with a level, such as `SET TRANSACTION`, must not run in it.
- At `repeatable read` and `serializable`, the snapshot of a transaction with [settings](#settings) comes from the statement of its settings, so it is taken before the callback starts.

## Lifecycle

- Objects with an explicit lifecycle, such as a database and a test fixture, are async disposable.
- Closing a database closes its test fixtures, including those still opening, and its [open test transactions](testing.md#open-test-transactions) on connections of their own, and then closes the driver; closing it inside a transaction or a session rejects, since the driver would wait for that transaction or session forever.
  An open test transaction whose opening the closing overtakes rolls back, releases its connection, and rejects.
  From the first closing, statements, transactions, sessions, and fixtures started outside a transaction and a session reject, so nothing opens after the fixtures close; the levels already running still end, also an [open session](#open-sessions), which runs its callbacks until it is closed, and a repeated closing returns the first one.

## Open questions

- Sessions inside a session: `session` rejects there, so code that starts a session cannot run in another one; decide whether it joins the enclosing session, with settings of its own that it restores.
- `$openSession` of a `Db`: a `Db` has `$session` but no `$openSession`, so code that has only a `Db` opens a session through `$database`, and a `Db` over a function that returns its database does not check that database in the callbacks of `run`, as it does in those of `$session`; decide whether a `Db` gets `$openSession` with that check.
