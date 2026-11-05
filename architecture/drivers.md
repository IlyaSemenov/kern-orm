# Drivers

- **Driver** (separate packages): transport, pooling, and connections.
  It sends parameters as text without declared types and returns result values as text, so that types alone define how values are represented and the statement text alone determines the types of parameters.
  It returns the number of rows of the command tag beside the rows, which a mutation without `RETURNING` resolves to, and the names of the result columns, which a query of SQL text reads its fields by.
  It also executes a script of several statements without parameters, which a statement with parameters cannot hold, since PostgreSQL takes several statements only in a query of its simple protocol; it ignores the results of a script.
  A connection runs its statements and scripts one at a time in the order of calls, so a statement sent before `COMMIT` or `ROLLBACK` completes before it.
  The coordinator releases a transaction connection whatever the outcome, passing the failure of `BEGIN`, `COMMIT`, or `ROLLBACK`; the driver returns such a connection to its pool only once it is idle, and never returns a lost one.
  Closing a driver waits for the transactions on its reserved connections to end, including those still waiting for a connection, and then closes the connections.
- A driver package supports one major version of its client: a package without a suffix, such as `@kern-orm/postgres-js` or `@kern-orm/node-postgres`, the latest major version, and a package named with the suffix of an older major version, such as `@kern-orm/postgres-js-v3`, that version.
  A new major version of a client moves the package without a suffix to it, and a driver for the previous major version moves to a package with its suffix.

## Compatibility

A driver follows the [contract of package compatibility](compatibility.md), and relies on the contract of `execution/driver.ts`.

## Tests of the contract

`describeDriverContract` of `kern-orm/testing` declares the tests of the contract in PostgreSQL, for the driver packages and custom drivers:

- It takes the functions of a test runner, as `createTestHelpers` takes its hooks, and asserts with `node:assert/strict`, so that it runs with `node:test`, `bun:test`, and Vitest.
  The driver packages run it with `bun:test` and Vitest from the sources, and the package test with `node:test` against the packed packages.
- It has no check of `DATABASE_URL`: the caller declares it in a block that skips it, in the way of its test runner.
- `closesReservedConnections` leaves out the tests of a connection left in a transaction or lost for a client that cannot close a reserved connection, such as postgres.js 3.

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

## node-postgres

`@kern-orm/node-postgres` requires `pg` 8 and takes its `Pool`.
It imports only types from `pg`, which `@types/pg`, an optional peer dependency, gives consumers.

It rejects a client that cannot give values as text whenever it gets one from the pool:

- a client of `pg.native`, which ignores `types` of a query, so it parses values;
- a client with `binary`, from the options of the pool or `pg.defaults`: it requests binary results of the statements of the extended protocol, which a query cannot turn off, and `pg` reads them as UTF-8 strings, which corrupts them.

`pg` leaves the release and closing contracts to its users, so the driver keeps them:

- It runs a statement or a script on the pool on a client of its own rather than through `pool.query`, which closes the connection of any failed statement, such as a violated constraint.
  It keeps the connection of a statement rejected with the severity `ERROR`, and closes it after any other failure: after `query_timeout`, the statement still runs on the connection.
- It closes the connection of a transaction released with a failure, without inspecting the failure, so a failed `COMMIT` costs a reconnect; `pg` returns a client released without a failure to the pool unless its connection is lost.
- It runs the statements and scripts of a reserved connection one at a time by itself: `pg` queues the queries of a client, but deprecates calling `client.query` while a query runs and removes it in `pg` 9.
- It listens to `error` of the pool, and of each client from the `acquire` event of the pool to its `release` event: a connection that breaks emits `error`, also without a running query, and an `EventEmitter` throws an `error` event without a listener, which terminates the process.
  The pool emits these events while its own listener of the client is in place, so a client has no moment without a listener, also while the pool verifies it and when the messages that open a connection and report its failure come in one read.
  The pool has already removed an idle connection that breaks, and the next query on a held client rejects, so the listeners do nothing.
- Closing it rejects a new statement or connection at once and calls `pool.end()` once every statement on the pool and reserved connection has returned, including those waiting for a connection: `pool.end()` never serves the `pool.connect()` calls waiting for one.

It sends statements and reads results as follows:

- It sends a statement with the extended protocol also without parameters, `queryMode: "extended"`, since `pg` would send it with the simple protocol, which runs several statements of one text, such as of `$query`; the extended protocol rejects them before running any.
- It sends parameters as strings and `null`, which `pg` binds as text without declared types.
- It reads rows as arrays with `types` of a query whose parser keeps every value as text, whatever parsers the client has.
- It executes a script as a query without `values`, which `pg` sends with the simple protocol, with the same `types`, so that the parsers of the client never run on its ignored results.
- It gives only the first word of a command tag as `command`, such as `CREATE` of `CREATE TABLE`, as `pg` parses it.
