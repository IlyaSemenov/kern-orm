# Release with the failure after `QueryError` of `COMMIT`

The coordinator releases the connection of a transaction with every failure of its `BEGIN`, `COMMIT`, or `ROLLBACK`, also a `QueryError`, after which the driver returns the connection to its pool only once it is idle.

The alternative releases the connection without a failure after a `QueryError` of these statements, since PostgreSQL rejected the statement and kept the connection.
It would save a reconnect of `@kern-orm/node-postgres`, which closes a connection released with a failure.

A `QueryError` of `COMMIT` does not tell that the connection is idle, though: an error that comes after PostgreSQL reads the statement and before it ends the transaction block aborts the transaction instead of ending it.
On PostgreSQL 18, a statement timeout that expires between `Parse` of `COMMIT` and its `Execute`, which the extended protocol counts as one statement, rejects `COMMIT` with `57014` of severity `ERROR`, and `ReadyForQuery` reports a failed transaction, whose next statement rejects with `25P02`.
A cancel that comes in the same window does the same by the sources of PostgreSQL, which was not reproduced.
A driver that trusted such a release would return a connection in an aborted transaction to its pool, whose next statements would fail until a `ROLLBACK`.
