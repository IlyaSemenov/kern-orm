# Lock timeout of one statement

The kern-jobs lease reaper sets `lock_timeout` in a materialized CTE joined to the rows it locks.
The setting takes effect only when the CTE runs, after PostgreSQL has acquired the table locks for the statement.
A plain schedule-cursor read on the pool also waited behind an `ACCESS EXCLUSIVE` table lock and stalled the worker's other checks.
A per-statement timeout would replace the reaper's CTE and bound such a read if the scheduler reintroduces it; deciding whether work is due still requires the row lock.

## Proposed contract

- Let a caller bound each lock wait of one statement that can run in a transaction block, including a table lock taken during parsing.
  Reuse the [transaction option](../architecture/transactions.md#settings): an integer from 0 to 2147483647 milliseconds, with 0 disabling the timeout and invalid values rejected before acquiring a connection or sending SQL.
- Consider an execution option on `Database.execute` and an immutable `.lockTimeout(ms)` on typed ORM queries and SQL queries started by `query`, `queryOn`, `$query`, and `$queryOn`.
  For [queries on an executor](../architecture/sql-queries.md), decide how an executor advertises support: a wrapper with only `execute(statement)` could silently ignore an extra argument.
  A timed query must use the caller's executor and must reject before sending SQL if that executor cannot enforce the timeout.
- On the pool, use one reserved connection at its default isolation level; in a session, use its existing connection.
  In an ambient transaction, preserve its isolation and leave commit to its owner.
  Use the coordinator's nested-level rules to restore the enclosing timeout on success and after a recoverable failure, including in test and external transactions.

## Implementation and verification

1. Prototype `BEGIN`, `SET LOCAL lock_timeout`, the original bound statement, and `COMMIT` on the same connection.
   Keep data parameters bound and apply the setting before the server parses the statement.
   Check snapshot timing at repeatable read and serializable if reusing the coordinator's settings query.
   The [driver contract](../architecture/drivers.md) accepts one command per bound statement; its script API takes no parameters and discards results.
2. Measure actual round trips on postgres.js, node-postgres, and Bun SQL against a one-statement transaction callback.
   Evaluate an optional driver operation for clients that can pipeline the sequence and sequential execution on a reservation for the others.
   In either path, a failure to apply the setting must prevent the target statement from running.
3. Hold `ACCESS EXCLUSIVE` from another connection and run a plain `SELECT` with a 100 ms timeout; repeat with a held row lock and `SELECT … FOR UPDATE`.
   Keep the blocker open until the call rejects with a `QueryError` for `lock_not_available` (55P03), allowing scheduling tolerance.
   After rollback, verify on the same backend that the next statement succeeds and `SHOW lock_timeout` returns its previous value.
   Repeat with a distinct enclosing timeout in a transaction and a session, checking restoration after success as well as failure wherever the enclosing level can continue.
4. Compare an uncontended statement's rows, column metadata, command tag, and count with ordinary execution.
   When the operation opens its own transaction, resolve only after PostgreSQL confirms its commit.
   Simulate connection loss after `COMMIT` may have been sent and check that `isOutcomeUnknown` reports the uncertain outcome even if rows have already arrived.
