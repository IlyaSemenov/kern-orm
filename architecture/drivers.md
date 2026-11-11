# Drivers

- **Driver** (`drivers/` of kern-db, or a custom driver): transport, pooling, and connections.
  It sends parameters as text without declared types and returns result values as text, so that types alone define how values are represented and the statement text alone determines the types of parameters.
  It returns the number of rows of the command tag beside the rows, which a mutation without `RETURNING` resolves to, and the names of the result columns, which a query of SQL text reads its fields by.
  A statement without a command, such as an empty text or only a comment, which PostgreSQL completes with `EmptyQueryResponse` instead of a command tag, gives `command: null`, `count: 0`, and neither columns nor rows; `execute` does not reject it, since telling it apart takes parsing the SQL.
  It also executes a script of several statements without parameters, which a statement with parameters cannot hold, since PostgreSQL takes several statements only in a query of its simple protocol; it ignores the results of a script.
  A connection runs its statements and scripts one at a time in the order of calls, so a statement sent before `COMMIT` or `ROLLBACK` completes before it.
  It rejects a statement or script with the [errors](#errors) of `driver-error.ts`: with `QueryError` when PostgreSQL rejected it, and the connection stays usable, and with `ConnectionError` after any other failure, after which the connection may be lost or in an unknown state of its transaction.
  It sets `unsent` of a `ConnectionError` only when it knows that the statement was not sent: after a failure to get a connection, after closing, and after a refusal of its client before sending.
  A reserved connection that is lost rejects every later statement on it with `ConnectionError`, also outside a transaction, so that no statement of a transaction runs outside it on a new connection, and none of a [session](transactions.md#sessions) without its settings.
  It rejects a statement or script on the pool that leaves its connection in a transaction, such as `BEGIN`, with `ConnectionError`.
  A script whose statement PostgreSQL rejected in that transaction may reject with that `QueryError` instead.
  Either way, the driver closes the connection or rolls the transaction back, so that no later statement on the pool runs in it.
  `release` returns a reserved connection to the pool once its statements complete, only when it is idle by the status of the transaction that PostgreSQL reports in `ReadyForQuery` after every statement, and closes it otherwise, which rolls back a transaction left on it.
  After a `ConnectionError`, the statement may still run or the connection may be lost, so `release` closes the connection, unless its client refused the statement without breaking the exchange of messages and still reads the status, as postgres.js 4 does.
  The caller does not tell `release` how the statements on the connection ended, since the driver sees each of them ([decision](../decisions/drivers/release-by-driver.md)).
  It replaces an idle connection whose backend exited, such as after a restart of the server, for the next statement once the client has read that the connection closed.
  Closing a driver rejects a new statement or script on the pool and a new connection from its call with `ConnectionError`, waits for the statements already sent and for the transactions on its reserved connections to end, including those still waiting for a connection, and then closes the connections.
- `isDriver` of `driver.ts` recognizes a driver by checking that its methods are functions rather than by a brand, since an application may write a driver of its own ([decision](../decisions/drivers/recognizing-drivers-and-databases.md)).
- A driver of kern-db supports one major version of its client, under a subpath named after the client, such as `kern-db/postgres-js` or `kern-db/node-postgres`, which requires the client by an optional peer dependency, so that importing `kern-db` loads no driver ([decision](../decisions/packages/database-package.md)).
  Supporting two major versions of a client at once takes a subpath of each.

## Errors

`QueryError` and `ConnectionError` tell a statement that PostgreSQL rejected from a failure that leaves the state of its connection unknown, such as for a retry of a violated unique constraint or of a lost connection.

- Each class recognizes an instance of another copy of `kern-db` by a brand of `Symbol.for`, which its constructor sets as a property that is not enumerable, and which `Symbol.hasInstance` of the class checks; a subclass checks the prototype chain ([decision](../decisions/drivers/error-recognition.md)).
  The declarations of the classes do not name the brand.
- A driver rejects with them a statement, a script, and a failure to get a connection, which is a `ConnectionError` whose `unsent` is `true` whatever its fields, such as a translated `FATAL` of a missing database.
  The coordinator passes them as they are, directly, as the `error` or `suppressed` of a `SuppressedError`, or as the `cause` of the [`TransactionConnectionError`](transactions.md#connection-failures) of a transaction whose connection failed; its other errors are plain errors.
- `unsent` of `ConnectionError` is a plain field rather than a subclass, so that a `TransactionConnectionError` of phase `begin` stays a `TransactionConnectionError`, and an error of another copy of `kern-db` without it reads as possibly sent.
- `toDriverError` classifies an error of a client by the fields of the PostgreSQL error it carries, for the drivers of kern-db and custom drivers:
  - an error that is already classified, also by another copy of `kern-db`, returns as it is;
  - a `ConnectionError` gets `unsent` of the fields, which the caller passes when it knows that the statement was not sent, and a `QueryError` ignores it;
  - an error without a severity is a `ConnectionError`: every error of the server has one, and an error of a client may have a code of five letters, such as `EPIPE`;
  - an error without a SQLSTATE of five digits or uppercase letters is a `ConnectionError`;
  - severity `ERROR` gives `QueryError`, and `FATAL` and `PANIC` give `ConnectionError`;
  - another severity, which is translated, gives `ConnectionError` for the SQLSTATE classes `08`, `28`, `57P`, and `XX` and the codes `25P03` and `25P04`, which end the session, and `QueryError` for the other codes.
- The SQLSTATE of a translated severity only approximates it: an error that ends the session with a code that a statement also gets, such as `40001` of a conflict with recovery on a replica, gives `QueryError`, and the next statement on the connection gives `ConnectionError`.
  Giving `ConnectionError` for every translated severity instead would reject a violated constraint with it, which a retry of `23505` needs as `QueryError`.

`isQueryError` of `error-condition.ts` tells a `QueryError` by the name of its condition, such as `unique_violation`, rather than by its SQLSTATE, and takes no constraint: a check of the constraint compares `constraint` of the error ([decision](../decisions/drivers/error-conditions.md)):

- It recognizes the error by `instanceof QueryError`, so also a `QueryError` of another copy of `kern-db`, and reads only `code`, which a `QueryError` of every version has; an error of a client with a `code` does not match.
- Its conditions are the names of the SQLSTATE codes of PostgreSQL 18 that PL/pgSQL takes in `EXCEPTION WHEN`, in `error-condition-codes.ts`, which is generated as a whole from `errcodes.txt` of PostgreSQL, and they match as in PL/pgSQL:
  - a name matches each of its codes, and a few names have two, such as `null_value_not_allowed`;
  - the condition of a class, whose code ends in `000`, matches every code of the class, also one that the table lacks, such as of a later version of PostgreSQL.
- It narrows `code` of the error to the codes of the condition rather than only the error to `QueryError`, so that a `QueryError` where the check fails stays one rather than `never`.
- An error that ends the session, such as of `admin_shutdown`, is a `ConnectionError`, which matches no condition.

## Compatibility

A custom driver relies on the contract of `driver.ts`, and on `QueryError`, `ConnectionError`, and `toDriverError` of `driver-error.ts`, which it imports from `kern-db` at runtime ([decision](../decisions/drivers/error-classes-of-kern-db.md)).

## Tests of the contract

`describeDriverContract` of `kern-db/testing` declares the tests of the contract in PostgreSQL, for the drivers of kern-db and custom drivers:

- It takes the functions of a test runner, as `createTestHelpers` takes its hooks, and asserts with `node:assert/strict`, so that it runs with `node:test`, `bun:test`, and Vitest.
  The tests of the drivers of kern-db run it with `bun:test` and Vitest from the sources, and the package test with `node:test` against the packed packages.
- It has no check of `DATABASE_URL`: the caller declares it in a block that skips it, in the way of its test runner.
- It runs on the `Database` of the database layer, with its queries of SQL text, types, and test helpers, and creates its tables as temporary tables or in test transactions, without tables of the ORM.
- It checks `unsent` of a statement, a script, and a connection after closing and of a driver of `createUnreachableDriver`, whose client cannot connect, and `unsent: false` for a statement whose connection is lost while it runs.

## postgres.js

`kern-db/postgres-js` requires postgres.js 4 and leaves to it the release contract and waiting for the outstanding work when closing:

- It classifies errors by `severity`, which postgres.js gives in English, rather than `severity_local`, and by `constraint_name`.
- It sets `unsent` of a statement on the pool by the code of its error, since postgres.js opens the connections of its pool by itself: of the codes that postgres.js 4 gives only before it sends a statement, of a failure to open a connection, of a timeout of the queue of the pool, of an ended client, and of a statement that it refuses to build.
  `CONNECTION_CLOSED` and `CONNECTION_DESTROYED` are not among them, since postgres.js gives them both to a statement that waits for a connection and to one that it sent, nor is a SQLSTATE of the server, also of a failed start, such as `3D000`: a sent statement gets its own `FATAL` error, which a function can raise with any code.
- It leaves the release to postgres.js, which returns a released connection to the pool once its statements complete and only when `ReadyForQuery` reports it idle, and closes one left in a transaction.
  postgres.js has closed a lost connection, and settles every other failed statement, such as one that it refuses to send, at the `ReadyForQuery` that follows it, so the status it reads is current.
- It leaves a statement on the pool that leaves a transaction open to postgres.js, which rejects it with `UNSAFE_TRANSACTION`, a `ConnectionError`, and rolls the transaction back, with the statements sent on the connection after it.
  postgres.js runs the pool of a client with `max: 1` as one session and lets such a statement through, so the transaction stays open for the next statements on the pool; the driver cannot tell, since postgres.js gives no status of a connection of its pool.
- Closing it rejects a new statement, script, or connection by itself and calls `sql.end()` at once: `sql.end()` ends the pool only after a few microtasks, and the pool queues and runs a statement sent before then.
  `sql.end()` waits for the reserved connections to be released and for the statements already sent to the pool, and gives the pending `sql.reserve()` calls a connection first.
- It sends every parameter, including `null`, with OID 705 (`unknown`), which postgres.js sends as it is instead of serializing it by the type PostgreSQL describes, and reads the bytes of text-format results through `.raw()` instead of parsing them.
- It sends a statement with the extended protocol also without parameters, `simple: false` of `unsafe`, since postgres.js would send it with the simple protocol, which runs several statements of one text, such as of `$query`; the extended protocol rejects them before running any.
- It executes a script with `.simple()` of `unsafe` without parameters, and reads its results through `.raw()`, so that the parsers of the client never run on them.
- It throws a `TypeError` at creation for a client with `transform.column.from` or `transform.row.from`, such as of `postgres.camel`: postgres.js applies them also to the results of `.raw()`, which would rename the result columns that kern-db reads values by, or replace the rows.
  It accepts a client with `transform.value.from`, which postgres.js skips for `.raw()`.

## node-postgres

`kern-db/node-postgres` requires `pg` 8 and takes its `Pool`.
It imports only types from `pg`, which `@types/pg`, an optional peer dependency, gives consumers.
`pg` gives the severity of an error only in the language of the server, so with translated messages, the driver classifies errors by their SQLSTATE, with the [limitation](#errors) of `toDriverError`.

It rejects a client that cannot give values as text with `ConnectionError` whenever it gets one from the pool:

- a client of `pg.native`, which ignores `types` of a query, so it parses values;
- a client with `binary`, from the options of the pool or `pg.defaults`: it requests binary results of the statements of the extended protocol, which a query cannot turn off, and `pg` reads them as UTF-8 strings, which corrupts them.

`pg` leaves the release and closing contracts to its users, so the driver keeps them:

- It runs a statement or a script on the pool on a client of its own rather than through `pool.query`, which closes the connection of any failed statement, such as a violated constraint.
  It keeps the connection of a statement rejected with `QueryError`, and closes it after `ConnectionError`: after `query_timeout`, the statement still runs on the connection.
- `pg` returns a client to the pool whatever its transaction, so the driver reads `getTransactionStatus()` of the client after a statement or script on the pool and on `release` of a reserved connection, and closes a connection that is not idle, rejecting a statement or script on the pool that left it in a transaction.
- `pg` rejects a statement at its `ErrorResponse`, before the `ReadyForQuery` that updates the status, so after a statement that PostgreSQL rejected, the driver waits for the status with an empty query, which runs no statement, also in a failed transaction, rather than close the connection, which would make the next statement reconnect.
  On the pool, only a script needs it: a statement of the extended protocol that PostgreSQL rejects ends the implicit transaction it ran in, while a script may have started a transaction block that its failed statement aborted.
- It runs the statements and scripts of a reserved connection one at a time by itself: `pg` queues the queries of a client, but deprecates calling `client.query` while a query runs and removes it in `pg` 9.
- It listens to `error` of the pool, and of each client from the `acquire` event of the pool to its `release` event: a connection that breaks emits `error`, also without a running query, and an `EventEmitter` throws an `error` event without a listener, which terminates the process.
  The pool emits these events while its own listener of the client is in place, so a client has no moment without a listener, also while the pool verifies it and when the messages that open a connection and report its failure come in one read.
  The pool has already removed an idle connection that breaks, and the next query on a held client rejects, so the listeners do nothing.
- Closing it rejects a new statement or connection at once and calls `pool.end()` once every statement on the pool and reserved connection has returned, including those waiting for a connection: `pool.end()` never serves the `pool.connect()` calls waiting for one.
- It gets a client before it sends a statement on the pool, so every failure to get one, including of a client that it rejects, sets `unsent` to `true`.

It sends statements and reads results as follows:

- It sends a statement with the extended protocol also without parameters, `queryMode: "extended"`, since `pg` would send it with the simple protocol, which runs several statements of one text, such as of `$query`; the extended protocol rejects them before running any.
- It sends parameters as strings and `null`, which `pg` binds as text without declared types.
- It reads rows as arrays with `types` of a query whose parser keeps every value as text, whatever parsers the client has.
- It executes a script as a query without `values`, which `pg` sends with the simple protocol, with the same `types`, so that the parsers of the client never run on its ignored results.
- It gives only the first word of a command tag as `command`, such as `CREATE` of `CREATE TABLE`, as `pg` parses it.
