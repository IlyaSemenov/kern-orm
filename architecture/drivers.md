# Drivers

- **Driver** (separate packages): transport, pooling, and connections.
  It sends parameters as text without declared types and returns result values as text, so that types alone define how values are represented and the statement text alone determines the types of parameters.
  It returns the number of rows of the command tag beside the rows, which a mutation without `RETURNING` resolves to, and the names of the result columns, which a query of SQL text reads its fields by.
  It also executes a script of several statements without parameters, which a statement with parameters cannot hold, since PostgreSQL takes several statements only in a query of its simple protocol; it ignores the results of a script.
  A connection runs its statements and scripts one at a time in the order of calls, so a statement sent before `COMMIT` or `ROLLBACK` completes before it.
  The coordinator releases a transaction connection whatever the outcome, passing the failure of `BEGIN`, `COMMIT`, or `ROLLBACK`; the driver returns such a connection to its pool only once it is idle, and never returns a lost one.
  Closing a driver waits for the transactions on its reserved connections to end, including those still waiting for a connection, and then closes the connections.
- A driver package supports one major version of its client: `@kern-orm/postgres-js` the latest major version of postgres.js, and a package named with the suffix of an older major version, such as `@kern-orm/postgres-js-v3`, that version.
  A new major version of a client moves the package without a suffix to it, and a driver for the previous major version moves to a package with its suffix.

## Compatibility

A driver requires `kern-orm` by a range of the whole 0.x series, such as `>=0.2.0 <1`, as a peer dependency, so that a new minor version of `kern-orm` does not release the drivers.
A published version keeps its range forever, so this contract covers every published driver:

- A later version of `kern-orm` before 1.0 must keep working with every published driver, so the contract of `execution/driver.ts` must not start to require a new method, parameter, or result field, or change the meaning of an existing one.
  The package test runs the first published version of each driver with such a range with the current `kern-orm`.
- A driver that starts to rely on a newer version of `kern-orm` must raise the minimum of its range.
  The package test runs each driver with that version.
- A change that cannot keep the contract requires a decision about the published drivers before the change.

## postgres.js

`@kern-orm/postgres-js` requires postgres.js 4 and leaves the release and closing contracts to it:

- It releases a connection without inspecting the failure: postgres.js returns a released connection to the pool once its statements complete and only when it is idle, closes one left in a transaction, and has already closed a lost one.
- Closing it calls `sql.end()` at once: `sql.end()` waits for the reserved connections to be released and gives the pending `sql.reserve()` calls a connection first; statements already sent to the pool complete, and later ones reject.
- It sends every parameter, including `null`, with OID 705 (`unknown`), which postgres.js sends as it is instead of serializing it by the type PostgreSQL describes, and reads the bytes of text-format results through `.raw()` instead of parsing them.
- It sends a statement with the extended protocol also without parameters, `simple: false` of `unsafe`, since postgres.js would send it with the simple protocol, which runs several statements of one text, such as of `$query`; the extended protocol rejects them before running any.
- It executes a script with `.simple()` of `unsafe` without parameters, and reads its results through `.raw()`, so that the parsers of the client never run on them.

## postgres.js 3

`@kern-orm/postgres-js-v3` requires postgres.js 3.4.9 and sends parameters, statements, and scripts as `@kern-orm/postgres-js` does; postgres.js 3.4.9 reads the `simple` option of `unsafe`, though its types omit it.
postgres.js 3.4.9 has bugs that postgres.js 4 fixes, and the driver works around those it can:

- When a connection breaks inside a transaction, including one of its own `sql.begin`, the next statement on it throws an uncaught exception ([#1199](https://github.com/porsager/postgres/issues/1199), [#1208](https://github.com/porsager/postgres/issues/1208), [#1248](https://github.com/porsager/postgres/issues/1248)).
  Node.js terminates the process; Bun 1.4.4 reports the exception and keeps running with a pool that never settles further queries.
  The driver cannot detect the loss before that statement.
- Releasing a lost reserved connection breaks the pool the same way, and postgres.js cannot close a reserved connection, so the driver leaves a connection that may be lost reserved; a connection that is alive in an unknown transaction state, such as after a client-side error building `COMMIT`, stays reserved too.
  After a server error other than `FATAL` and `PANIC`, the driver rolls back a failed transaction and releases the connection.
- `sql.end()` never resolves when a reserved connection is released after it starts ([#1261](https://github.com/porsager/postgres/issues/1261)), so closing the driver:
  - rejects acquiring a connection once it starts;
  - waits for the reserved connections the driver will release, and for the transactions waiting for a connection; once no running transaction of the driver holds a connection, those transactions get `closeTimeout` to get one;
  - ends the client with `closeTimeout` when a connection is kept reserved or a transaction still waits, which terminates an alive kept connection and rejects the waiting transaction.
- With `fetch_types: false`, the first `sql.reserve()` on a pool without an open connection never settles, so the first transaction waits until the driver closes ([#1219](https://github.com/porsager/postgres/issues/1219)); users must not disable `fetch_types`.
