# kern-db

## 0.18.0

### Minor Changes

- 50a5498: Add the built-in type `timestamptzPortable`, which reads a `timestamptz` with microsecond precision under any `DateStyle` and `TimeZone` settings and binds it back as the same instant under any `DateStyle`.

## 0.17.0

### Minor Changes

- 388adcf: Add `runInExternalTransaction()` of kern-db, which runs a callback with a database of a transaction that another library started, and let `runInOrchidTransaction()` pass such a database to its callback when called without one.

## 0.16.0

### Minor Changes

- 4f4be58: Add `literal()` to write a value into a statement as a SQL literal and `unsafeSql()` to write SQL text into it as it is, for the places that take no parameter.
- 4c3a3ed: Export the type `SqlQueryTemplate` of `database.query` and of the template that `queryOn()` returns.

## 0.15.0

### Minor Changes

- 32495e3: Add `joinSql(items, separator?)`, which joins SQL fragments and values into one fragment, such as the rows of a multi-row `VALUES`, to `kern-db`, `kern-orm/db`, and `kern-orm`.
- fa6aeaf: Add `bunSqlDriver` from `kern-db/bun-sql` for Bun's built-in PostgreSQL client.
- 47bd12f: Add `catch()` and `finally()` of a Promise to the queries that execute when awaited: the queries of a `Db`, such as `db.form.select("id")` and `db.$query`, and those of `database.query` and `queryOn`.

## 0.14.0

### Minor Changes

- aca9182: Add `comment(label)`, which starts a statement with `/* label */`, to the queries of `database.query`, `queryOn`, and `db.$query`.

## 0.13.0

### Minor Changes

- d1a0998: `database.query` and `queryOn` bind a `param` that a statement repeats as one parameter.
- 1131d4e: Add `queryOn`, which starts a query of SQL text on a driver, a connection, or any other object with `execute`, such as ``queryOn(connection)`SELECT count(*) FROM job`.get(t.integer)``, with the template and the results of `database.query`.

### Patch Changes

- 69f5b83: Faster encoding and decoding of `bytea` values.
- c4b275d: Faster decoding of `date`, `time`, `timestamp`, and `timestamptz` values.
- f1b9ba9: Faster decoding of arrays with quoted elements.
- db22877: Stricter decoding of `boolean`, `bytea`, and `vector` values, which rejects text in a format other than that of PostgreSQL.

## 0.12.0

### Minor Changes

- b3bae8d: Add `RecordOf`, which names the type of the record that `select` of a query of SQL text decodes from the columns of `columnsOf` or `createSqlColumns`.

## 0.11.0

### Minor Changes

- fb2df72: Add the types `jsonWithJsonNull` and `jsonbWithJsonNull`, which read and write a top-level JSON `null` value as `jsonNull` and `NULL` as `null`, such as `t.jsonbWithJsonNull.of<Payload | JsonNull>().nullable()`.
- df302b6: Add `nullableAs` to types, such as `t.jsonb.nullableAs(() => undefined)`, which reads `NULL` as `undefined` and a JSON `null` value as `null`.

## 0.10.0

### Minor Changes

- b7ac15c: Add the `read` option of `defineType`, the SQL expression by which queries read the values of a custom type, such as `` read: value => `extract(epoch from ${value})` `` for a `timestamptz` read as seconds since the epoch.
- 495a983: Add `createSqlColumns` to `kern-db/builder`, which creates the columns of a record that a statement of SQL text selects; `select` of `database.query` reads them as a nested record.
  Add `cutIdentifier` to `kern-db/builder`, which cuts a name to fit a number of bytes in any server encoding.

## 0.9.1

### Patch Changes

- ce8f3d6: Tell in the errors of date and `bytea` values in another `DateStyle` or `bytea_output` that the connection options of the client can set them.

## 0.9.0

### Minor Changes

- cc0f7e8: Add the `lockTimeout` option of `database.transaction()`, `database.session()`, and `database.openSession()`, which sets how long their statements can wait for each lock, in milliseconds, such as `database.transaction(callback, { lockTimeout: 1000 })`.

## 0.8.0

### Minor Changes

- 4f3196d: Allow the callbacks of transactions, sessions, test helpers, and `runInOrchidTransaction()` to return a query directly without `async`, such as `db.$transaction(() => db.post.insert(values))`.
- fcfd1a5: Add `database.externalTransaction()`, which runs a callback in a transaction that another library started and ends, and `postgresJsConnection()` of `kern-db/postgres-js`, which adapts the client of a transaction of postgres.js for it.
- d2c66f2: Add the `getNativeParameters` option of `postgresJsDriver`, so that query builders can pass JavaScript values to postgres.js for serialization.

### Patch Changes

- d509714: Fix queries running outside their transaction or session when an untyped callback returns them directly.

## 0.7.0

### Minor Changes

- f2aa9b1: Add `database.openSession()`, which keeps a session open across callbacks until it is closed, such as to hold an advisory lock on one connection while a worker runs.
- 32df409: Add the `vector` type of pgvector, whose values are arrays of numbers.
- cb64c06: Return `DriverResult.columns` as objects with `name` and PostgreSQL type OID in `type`, including for results without rows; custom drivers and consumers of column names must use this metadata shape while values remain text or `null`.

### Patch Changes

- 9a0ce84: Reduce peak memory usage when reading large results through the postgres.js driver.

## 0.6.1

### Patch Changes

- ccc894e: `describeDriverContract` also checks that a driver reports the number of rows of a `SELECT`.

## 0.6.0

### Minor Changes

- 4f6a8e9: Add `isOpen` to an open test transaction, which tells whether it still runs callbacks or was closed, such as rolled back by the test transaction of the next browser test.

## 0.5.0

### Minor Changes

- b64ad58: Add `openTestFixture` and `openTestTransaction` to isolate browser tests against a running server in transactions that roll back after each test.
- fc7fcff: Fix test transactions failing every later query of a test once a query of the tested code outside a transaction failed, such as an insert that violates a unique constraint, and queries of a test failing beside a running transaction of the tested code; a test that passes also waits for the transactions that it started without awaiting them instead of failing.
- feabf2f: Add `wrapTest` to run `node:test` and `bun:test` tests in test transactions, which roll back as soon as a test times out; under `bun:test`, pass `onTestFinished` to `createTestHelpers` for that.

## 0.4.0

### Minor Changes

- 2ca43cc: Add `error.unsent` to `ConnectionError`, for which `isOutcomeUnknown` returns `false` when it is `true`, and require `createUnreachableDriver` in `describeDriverContract`.

## 0.3.0

### Minor Changes

- 1cf41eb: Add helpers to read backend PIDs and wait for blocked statements in `kern-db/testing` and `kern-orm/testing`.
- 9923ac1: Add `isOutcomeUnknown`, which tells whether the outcome of a failed statement or transaction is unknown because its connection failed.

## 0.2.0

### Minor Changes

- 96bc354: Add `isDriver` and `isDatabase` to `kern-db` and `kern-orm/db`, which tell a driver and a database from another value, such as a client of PostgreSQL passed instead.

## 0.1.0

### Minor Changes

- 614dfd7: Release `kern-db`, the database layer of `kern-orm`, which works without the ORM.
