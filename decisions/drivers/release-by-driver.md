# Release decided by the driver

`release` of a reserved connection takes no argument: the driver returns the connection to its pool only when the connection is idle and it can trust that status, and closes it otherwise.
After a `ConnectionError`, it trusts the status only when its client refused the statement without breaking the exchange of messages, as postgres.js 4 does for a statement of too many parameters.
Each driver tells this from what it has seen on the connection and from the status of its transaction, which PostgreSQL reports in `ReadyForQuery` after every statement:

- The driver of postgres.js leaves it to postgres.js 4, which reads the status on release once the statements of the connection complete, has closed a lost connection, and settles every other failed statement at the `ReadyForQuery` that follows it.
- The driver of node-postgres remembers whether a statement failed with `ConnectionError` and reads `getTransactionStatus()` of `pg`; after a statement that PostgreSQL rejected, it first waits for that status with an empty query.

```ts
// The caller only releases the connection, whatever happened on it.
const connection = await driver.acquire()
try {
  await connection.execute(createStatement("SELECT 1"))
} finally {
  await connection.release()
}
```

## The caller passes the failure of the last statement

`release(failure?)` took the failure of the last statement when it failed, and the driver returned such a connection to its pool only once it was idle.
It saved the drivers from tracking the statements and reading the status, but:

- A `QueryError` of `COMMIT` does not tell that the connection is idle, so the coordinator passed every failure of `BEGIN`, `COMMIT`, and `ROLLBACK`, and the driver of node-postgres, which did not read the status, closed the connection after every failed `COMMIT`, such as of a deferred constraint or a serialization failure, which made the next statement reconnect.
  On PostgreSQL 18, a statement timeout that expires between `Parse` of `COMMIT` and its `Execute`, which the extended protocol counts as one statement, rejects `COMMIT` with `57014` of severity `ERROR`, and `ReadyForQuery` reports a failed transaction; a cancel that comes in the same window does the same by the sources of PostgreSQL, which was not reproduced.
- Every caller of a bare driver had to remember the failure of its last statement, such as the heartbeat of kern-jobs, which kept it to pass it on release.
- No caller saw a transaction that a statement left open without failing, such as a `BEGIN` sent on a reserved connection.

## The driver remembers the outcome of the last statement

A driver of a client that gives no status, such as postgres.js 3, can remember how the last statement on the connection ended, and probe the connection after a `QueryError`, such as with `SELECT 1`, which rejects with `25P02` in a failed transaction, before a `ROLLBACK`.
It misses a transaction that a statement left open without failing, and the probe costs a round trip.

## The status alone

The status tells an idle connection from one in a transaction or a failed one, but not from one that the driver must not trust:

- After a `ConnectionError`, the statement may still run, such as after `query_timeout` of `pg`, or the connection may be lost, so such a connection returns only when its client refused the statement without breaking the exchange of messages.
- `pg` rejects a statement at its `ErrorResponse`, before the `ReadyForQuery` that updates the status, so after a `QueryError`, the status that `pg` gives may be that of the statement before.

## Closing after a `QueryError` instead of waiting for the status

The driver of node-postgres could close a connection whose last statement PostgreSQL rejected instead of waiting for its status.
The wait costs a round trip of an empty query, while closing makes the next statement reconnect: from the release to the end of the next statement on a local PostgreSQL 18, the [benchmark](../../benchmarks/suites/release-after-rejected-statement.ts) measures closing at about 20 times the time of the wait.

## Closing a connection left in a transaction

A driver could roll back a connection left in a transaction and return it to the pool, which saves a reconnect.
It closes such a connection instead, which rolls the transaction back without a statement that may fail: a transaction left open is a mistake of the caller or a failed end of a transaction, which is rare.
postgres.js 4 closes such a connection on release too.
