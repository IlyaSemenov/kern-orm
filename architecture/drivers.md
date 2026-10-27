# Drivers

- **Driver** (separate packages): transport, pooling, and connections.
  It sends parameters as text without declared types and returns result values as text, so that types alone define how values are represented and the statement text alone determines the types of parameters.
  A connection runs its statements one at a time in the order of calls, so a statement sent before `COMMIT` or `ROLLBACK` completes before it.
  The coordinator releases a transaction connection whatever the outcome, passing the failure of `BEGIN`, `COMMIT`, or `ROLLBACK`; the driver returns such a connection to its pool only once it is idle, and never returns a lost one.
  Closing a driver waits for the transactions on its reserved connections to end, including those still waiting for a connection, and then closes the connections.

## Open questions

- Connection loss with postgres.js 3.4.9: when a connection breaks inside a transaction, including one of its own `sql.begin`, the next statement on it throws an uncaught exception.
  Node.js terminates the process; Bun 1.4.4 reports the exception and keeps running with a pool that never settles further queries.
  The driver cannot detect the loss before that statement, so this waits for the upstream fixes of [#1199](https://github.com/porsager/postgres/issues/1199), [#1208](https://github.com/porsager/postgres/issues/1208), and [#1248](https://github.com/porsager/postgres/issues/1248).
  Releasing a lost reserved connection breaks the pool the same way, and postgres.js cannot close a reserved connection, so the driver leaves a connection that may be lost reserved; a connection that is alive in an unknown transaction state, such as after a client-side error building `COMMIT`, stays reserved too.
  `sql.end()` of postgres.js 3.4.9 never resolves when a reserved connection is released after it starts ([#1261](https://github.com/porsager/postgres/issues/1261)), so closing the driver:
  - rejects acquiring a connection once it starts;
  - waits for the reserved connections the driver will release, and for the transactions waiting for a connection; once no running transaction of the driver holds a connection, those transactions get `closeTimeout` to get one;
  - ends the client with `closeTimeout` when a connection is kept reserved or a transaction still waits, which terminates an alive kept connection and rejects the waiting transaction.
- `fetch_types: false` with postgres.js 3.4.9: the first `sql.reserve()` on a pool without an open connection never settles, so the first transaction waits until the driver closes; this waits for the upstream fix of [#1219](https://github.com/porsager/postgres/issues/1219).
