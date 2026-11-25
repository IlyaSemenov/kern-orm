# kern-orm

## 0.31.0

### Minor Changes

- c8622c2: Add `db.$queryOn(executor)`, the template of `db.$query` that runs its statement on a driver, a connection, or another executor of statements.

## 0.30.0

### Minor Changes

- 4f4be58: Add `literal()` to write a value into a statement as a SQL literal and `unsafeSql()` to write SQL text into it as it is, for the places that take no parameter.
- 4c3a3ed: Export the type `SqlQueryTemplate` of `database.query` and of the template that `queryOn()` returns.

### Patch Changes

- Updated dependencies: kern-db@0.16.0

## 0.29.0

### Minor Changes

- 32495e3: Add `joinSql(items, separator?)`, which joins SQL fragments and values into one fragment, such as the rows of a multi-row `VALUES`, to `kern-db`, `kern-orm/db`, and `kern-orm`.
- fa6aeaf: Add `bunSqlDriver` from `kern-orm/db/bun-sql` for Bun's built-in PostgreSQL client.
- 47bd12f: Add `catch()` and `finally()` of a Promise to the queries that execute when awaited: the queries of a `Db`, such as `db.form.select("id")` and `db.$query`, and those of `database.query` and `queryOn`.

### Patch Changes

- Updated dependencies: kern-db@0.15.0

## 0.28.0

### Minor Changes

- aca9182: Add `comment(label)`, which starts a statement with `/* label */`, to the queries of `database.query`, `queryOn`, and `db.$query`.

### Patch Changes

- Updated dependencies: kern-db@0.14.0

## 0.27.0

### Minor Changes

- d1a0998: A `param` that a statement repeats binds as one parameter in every query, not only in a query of `groupBy`.
- 1131d4e: Add `queryOn`, which starts a query of SQL text on a driver, a connection, or any other object with `execute`, such as ``queryOn(connection)`SELECT count(*) FROM job`.get(t.integer)``, with the template and the results of `database.query`.

### Patch Changes

- Updated dependencies: kern-db@0.13.0

## 0.26.0

### Minor Changes

- ac121e8: `columnsOf` takes the columns to select as its required second argument, `"*"` for all the columns of the table or an array of column keys, instead of selecting all the columns without the `columns` option.
- b3bae8d: Add `RecordOf`, which names the type of the record that `select` of a query of SQL text decodes from the columns of `columnsOf` or `createSqlColumns`.

### Patch Changes

- Updated dependencies: kern-db@0.12.0

## 0.25.0

### Minor Changes

- fb2df72: Add the types `jsonWithJsonNull` and `jsonbWithJsonNull`, which read and write a top-level JSON `null` value as `jsonNull` and `NULL` as `null`, such as `t.jsonbWithJsonNull.of<Payload | JsonNull>().nullable()`.
- df302b6: Add `nullableAs` to types, such as `t.jsonb.nullableAs(() => undefined)`, which reads `NULL` as `undefined` and a JSON `null` value as `null`.

### Patch Changes

- Updated dependencies: kern-db@0.11.0

## 0.24.0

### Minor Changes

- 495a983: Add `columnsOf`, which gives the columns of a table for a statement of `db.$query`.
  `select` reads them as the record of the row, which `nullable` makes `null` without a match of an outer join.
- b7ac15c: Add the `read` option of `defineType`, the SQL expression by which queries read the values of a custom type, such as `` read: value => `extract(epoch from ${value})` `` for a `timestamptz` read as seconds since the epoch.

### Patch Changes

- 530b7e4: Fix `select` on queries and mutations typing dynamically chosen columns as always present.
- Updated dependencies: kern-db@0.10.0

## 0.23.0

### Minor Changes

- db84299: Add `kern-orm/db/builder`, which re-exports `kern-db/builder`.

## 0.22.0

### Minor Changes

- 18b8a16: Add `query.comment(label)` to identify a query in PostgreSQL activity and logs.

### Patch Changes

- Updated dependencies: kern-db@0.9.1

## 0.21.0

### Minor Changes

- cc0f7e8: Add the `lockTimeout` option of `db.$transaction()` and `db.$session()`, which sets how long their queries can wait for each lock, in milliseconds, such as `db.$transaction(callback, { lockTimeout: 1000 })`.

### Patch Changes

- Updated dependencies: kern-db@0.9.0

## 0.20.0

### Minor Changes

- 4f3196d: Allow the callbacks of transactions, sessions, test helpers, and `runInOrchidTransaction()` to return a query directly without `async`, such as `db.$transaction(() => db.post.insert(values))`.
- fcfd1a5: Add `database.externalTransaction()`, which runs a callback in a transaction that another library started and ends, and `postgresJsConnection()` of `kern-db/postgres-js`, which adapts the client of a transaction of postgres.js for it.
- d2c66f2: Add the `getNativeParameters` option of `postgresJsDriver`, so that query builders can pass JavaScript values to postgres.js for serialization.
- d221b73: Read ordinary and materialized PostgreSQL views through typed queries with `defineView`.

  `createTableFactory(options)` returns `{ defineTable, defineView }` with a shared column naming convention.
  Change `const defineTable = createTableFactory(options)` to `const { defineTable } = createTableFactory(options)`.

### Patch Changes

- d509714: Fix queries running outside their transaction or session when an untyped callback returns them directly.
- Updated dependencies: kern-db@0.8.0

## 0.19.0

### Minor Changes

- 0210dc8: Add the arithmetic operators `add`, `sub`, `mul`, and `div` to number types, and `mod` to integers and `numeric`, such as `update(field => ({ position: field.position.add(1) }))`, with `arithmeticOperators` and `exactArithmeticOperators` for custom types.
- f2aa9b1: Add `database.openSession()`, which keeps a session open across callbacks until it is closed, such as to hold an advisory lock on one connection while a worker runs.
- 32df409: Add the `vector` type of pgvector, whose values are arrays of numbers, with the distances `l2Distance`, `negativeInnerProduct`, `cosineDistance`, and `l1Distance`, such as `db.document.orderBy(document => document.embedding.cosineDistance(embedding))`, and `vectorOperators` for other vector types.
- cb64c06: Return `DriverResult.columns` as objects with `name` and PostgreSQL type OID in `type`, including for results without rows; custom drivers and consumers of column names must use this metadata shape while values remain text or `null`.

### Patch Changes

- Updated dependencies: kern-db@0.7.0

## 0.18.0

### Minor Changes

- 833d542: Add `none()` to queries, which makes a query find no records and skips the database where the result is known without it.

## 0.17.0

### Minor Changes

- 4d75439: Add `default()` of types and columns, such as `t.text.default("draft")` or `t.uuid.default(() => randomUUID())`: inserts may omit such a column, and kern-orm inserts the value, the `sql` fragment, or the result of the function instead.

## 0.16.0

### Minor Changes

- 3c4785e: Add `findTableMismatches` to `kern-orm/testing`, which checks the tables of a `Db` against its PostgreSQL schema, such as after migrating in a test.
- ccc894e: `update` without a value to set, such as `update({})`, changes no record and resolves to the number or the selected fields of the records it chooses, instead of throwing.

### Patch Changes

- a8a91fc: Fix the type of `select()` without keys, which added every column of the table to the result.
- Updated dependencies: kern-db@0.6.1

## 0.15.0

### Minor Changes

- ab1cd7d: `bindSchema` takes a function that returns the database, such as from dependency injection, so that a module-level `db` runs each query on the database of the current context.

## 0.14.0

### Minor Changes

- 4f6a8e9: Add `isOpen` to an open test transaction, which tells whether it still runs callbacks or was closed, such as rolled back by the test transaction of the next browser test.

### Patch Changes

- Updated dependencies: kern-db@0.6.0

## 0.13.0

### Minor Changes

- b64ad58: Add `openTestFixture` and `openTestTransaction` to isolate browser tests against a running server in transactions that roll back after each test.
- 6e281ac: `ResultOf` takes a helper of `defineHelper` and gives the type of the records that it selects, such as `ResultOf<typeof selectSummary>`.
- fc7fcff: Fix test transactions failing every later query of a test once a query of the tested code outside a transaction failed, such as an insert that violates a unique constraint, and queries of a test failing beside a running transaction of the tested code; a test that passes also waits for the transactions that it started without awaiting them instead of failing.
- feabf2f: Add `wrapTest` to run `node:test` and `bun:test` tests in test transactions, which roll back as soon as a test times out; under `bun:test`, pass `onTestFinished` to `createTestHelpers` for that.

### Patch Changes

- Updated dependencies: kern-db@0.5.0

## 0.12.1

### Patch Changes

- Updated dependencies: kern-db@0.4.0

## 0.12.0

### Minor Changes

- 1cf41eb: Add helpers to read backend PIDs and wait for blocked statements in `kern-db/testing` and `kern-orm/testing`.
- 9923ac1: Add `isOutcomeUnknown`, which tells whether the outcome of a failed statement or transaction is unknown because its connection failed.

### Patch Changes

- Updated dependencies: kern-db@0.3.0

## 0.11.0

### Minor Changes

- 96bc354: Add `isDriver` and `isDatabase` to `kern-db` and `kern-orm/db`, which tell a driver and a database from another value, such as a client of PostgreSQL passed instead.

### Patch Changes

- Updated dependencies: kern-db@0.2.0

## 0.10.0

### Minor Changes

- 3622f85: Add `db.$pollLock()` and `database.pollLock()`, which wait for an advisory lock in a session.
- dc9d413: Add `db.$session()` and `database.session()`, which run statements on one connection outside a transaction, with a search path of their own, and `db.$isInTransactionBlock()` and `database.isInTransactionBlock()`, which tell whether a statement runs in a transaction block.
- 0601b5e: Add `db.$tryLock()` and `database.tryLock()`, which take an advisory lock without waiting, in a transaction or a session, and tell whether they took it.
- fe27753: Replace `database.bind(schema, options)` with `bindSchema(schema, database, options)`, which also accepts databases created by `createDatabase` from `kern-orm/db`.
- fe27753: Remove `database.coordinator`; the test helpers of `kern-orm/testing` take the database itself.
- 26dcd49: Add `createDatabase`, the `Driver` contract, and the errors of drivers and transactions to `kern-orm/db`.
- 4e48d07: Add `sql`, `identifier`, and `param` to `kern-orm/db`; the template of `database.script` takes their fragments instead of the expressions of `kern-orm`.
- 9f73ce7: `database.query()` takes the fragments of `kern-orm/db` instead of the expressions of `kern-orm`, and `db.$execute()` and `db.$compile()` no longer take a query of `db.$query`.
- 9176e59: Add `kern-orm/db`, which exports `defineType` to define a PostgreSQL type without operators and the query builder, and `kern-orm/db/types`, which exports the built-in types without operators; `defineType()` of `kern-orm` creates a type with operators from such a type.
- c3ad320: Add `defineType(type)`, which copies a type without its operators, such as `defineType(t.text)` to give text other operators.
- dc048fb: `describeDriverContract` requires a driver to reject the statements of a reserved connection that is lost outside a transaction with `ConnectionError`.
- 614dfd7: Replace `@kern-orm/postgres-js` and `@kern-orm/node-postgres` with `kern-orm/db/postgres-js` and `kern-orm/db/node-postgres`.
- 5ddebed: `sql` and `db.$query` reject an object interpolated as a value, which they passed as JSON; pass JSON with `param(t.jsonb, value)`.

### Patch Changes

- c3ad320: Fix a type being accepted where a type of more accepted values is expected, such as `t.text` as a `Type<string, string | number>`.
- b9a5cae: Fix the declarations of a module that imports only `kern-orm/types`, such as a module of column presets, which failed with TS2883 when it exported a derived type or a column.
- Updated dependencies: kern-db@0.1.0

## 0.9.0

### Minor Changes

- d5abb00: Remove `closesReservedConnections` from `Driver`: `describeDriverContract` runs the tests of a connection left in a transaction or lost for every driver.
- efa431e: Add `isQueryError`, which checks a `QueryError` by its PostgreSQL condition, such as `unique_violation`.
- 6d8d33f: Remove `TransactionFailure` and the argument of `release` of a `Connection`: a driver decides by itself whether a released connection returns to the pool. `describeDriverContract` checks that a driver closes a released connection left in a transaction and rejects a statement on the pool that leaves a transaction open.
- 05f7a9d: Fix a committed transaction rejecting when releasing its connection failed; such failures go to `onReleaseError` of `createDatabase`, or to `console.error` without it.
- 97f3214: Reject a transaction whose connection fails with `TransactionConnectionError`, whose `phase` tells whether it may have been committed. Such a transaction no longer commits when its callback catches the failure.
- a2e90c6: Add `isolation` to the options of transactions, test transactions, and test fixtures.

## 0.8.0

### Minor Changes

- 17acc74: Add `closesReservedConnections` to `Driver`, which tells whether a driver closes a reserved connection that it cannot return to the pool, `false` for postgres.js 3; `describeDriverContract` reads it from the driver instead of its option.
- c2a2ee9: Add `QueryError` and `ConnectionError`, which drivers reject with, and `toDriverError` to classify errors in custom drivers.

## 0.7.0

### Minor Changes

- cdcac34: `describeDriverContract` requires a closing driver to reject a statement or a script on the pool and a new connection requested right after `close()`.
- c5b57b2: Require `json` and `jsonb` columns that are not `nullable` and have no default in inserts and reject `null` as their value in types, and keep `null` among the values that `transform` returns for a type that accepts `null`, such as a `nullable` JSON column.
- c5b57b2: Add `of<T>()` to every type to narrow its values in TypeScript, such as `t.text.of<"draft" | "published">()` for a column that a `CHECK` constraint limits.
- 090606d: Add the `singleton` option of `defineTable` for a table of at most one row, whose query reads, upserts, updates, and deletes the row without a key or `all()`.
- d17bb23: Add `onConflict(...columns).doNothing()` after `insert` and `insertMany` to skip records that conflict with existing ones on a key.
- 1d6518f: Add `merge` and `update` after `onConflict(...columns)` to update the existing records that inserted records conflict with on a key.
- 834a6b6: Add `upsert(values)` after `find` and `findBy` to insert the record of the key with the values or set the values of the existing record in one statement.

## 0.6.0

### Minor Changes

- 6d7d67b: Add a `filter` option to aggregate functions and a `stringAgg` function with an optional `orderBy`.
- 9c1ce64: Add aggregate functions of expressions, `count`, `countDistinct`, `min`, `max`, `sum`, `avg`, `every`, and `some`, which select several aggregates in one statement.
- 674f7e3: Allow aggregate methods and `exists` after `distinct` and `distinctOn`, such as `count` of the distinct rows for the total of a page or of the first rows of `distinctOn` for the number of groups.
- 86719d7: Add query method `distinctOn`, which keeps the first row of each group of rows, such as the latest submission of each user.
- c328400: Add query method `distinct`, which removes duplicate rows, such as of `pluck` for `in`.
- 6eaf63b: Remove unnecessary `null` from grouped aggregate results and require nullable SQL for aggregates of enclosing queries.
- a5c7c03: Add query methods `groupBy` and `having`, which group the rows of a query and filter the groups by their aggregates.
- d118398: Read a key with parameters of a query of `groupBy` in `having`, and sort by it without selecting it, when every copy of the key uses the same `param(type, value)`.
- 111f87a: Pass the selected fields to the callback of `having` as its second parameter, with the operators of their types, such as `having((submission, selected) => selected.submissions.gt(1))`, or the value of a query made by `get` or `pluck`.
- 96bf6be: Add `use` of an insert, an update, and a delete, which takes a callback or a helper of `defineHelper` that selects fields, so that one helper serves a query and a mutation alike.
- 0af439c: Add query methods `forUpdate`, `forNoKeyUpdate`, `forShare`, and `forKeyShare`, which lock the rows that a query reads, including nested queries, until its transaction ends, with options `noWait` and `skipLocked`.
- 32631f1: Add `createTableFactory({ columnName })` to derive column names from their keys with `toSnakeCase` or any other function, such as `form_id` from `formId`, while preserving explicit `columnName` values.
- 89688cf: Add query methods `transform` and `map` to convert results in code, including results of nested queries and of inserts, updates, and deletes; a helper of `defineHelper` can call `map`.

### Patch Changes

- ae45149: Fix a query with an offset that returned a row its offset should skip when a nested query aggregated the rows of the query in a SQL fragment through a query in the fragment, such as ``sql`count(${db.form.where({ id }).get(() => form.id)})` ``.
- 9e3410f: Fix the type of `command` of `DriverResult`, which omitted `null` for a statement without a command tag, such as an empty text, and check that value in `describeDriverContract`.

## 0.5.0

### Minor Changes

- 4656c07: Add `defineExpression`, which defines a reusable expression of a table with arguments that queries can filter and sort by, select, and combine with other expressions.
- ad7884b: Add `describeDriverContract` to `kern-orm/testing`, which tests a custom driver in PostgreSQL with any supported test runner.
- 740af0d: Add `matches` to turn an object of column values into a Boolean expression for use in `select` and `defineExpression`.
- 6db2c8d: Allow a query of one value, such as of `get` or an aggregate, as a value of `insert`, `insertMany`, and `update`.
- e9e747c: Allow reading related records in the callbacks of `get`, `pluck`, the aggregate methods, and `update`, such as `db.form.pluck(form => form.fields.count())`.
- 7be282f: Remove `defineFilter`, which could apply its objects of column values to the table of another `where`; define reusable conditions with `defineExpression` and `matches` instead.

### Patch Changes

- ce0c36f: Fix type errors on literals of an enum column returned from the callbacks of `where` and `update`, such as `update(() => ({ status: "live" }))`.

## 0.4.0

### Minor Changes

- 4b826fe: Add `TRUE` and `FALSE`, constant conditions for a branch of a condition built in code.
- 833d083: Add `caseWhen` to choose a value based on conditions, with an explicit result type.
- b12e8a6: Add the functions `coalesce`, `greatest`, and `least`, which compute a value from expressions and queries, typed by their operands.
- 56030de: Add `literal` to select a value from code as a field of a record without sending it to PostgreSQL, such as `withHint ? field.hint : literal(null)`.
- e73620b: Add `lower`, `upper`, `trim`, and `length` operators of text expressions.

### Patch Changes

- 38cea9e: Fix invalid conditions such as `false` or a `Date` being treated as `TRUE` instead of throwing an error in `where`, `and`, `or`, and `not`.

## 0.3.0

### Minor Changes

- 20a8c17: Add `db.$lock()` and `database.lock()` to take an advisory lock of a key until the current transaction ends.
- a968de8: Add `db.$ensureTransaction()` and `database.ensureTransaction()` to run a callback in the current transaction or a new one, and `db.$isInTransaction()` and `database.isInTransaction()` to tell whether code runs in a transaction.
- 4e7885b: Pass a query of values to `in`, such as `form.id.in(db.submission.where({ userId }).pluck("formId"))`, to match any of its values.
- 94c2d9b: Sort by the value of a query, such as forms by the number of their fields with `orderBy(form => desc(form.fields.count()))`.
- e7b2956: Filter records by their related records, such as `db.form.where(form => form.fields.exists())`.
- db67b6c: Add `exists()` to tell whether a query has rows, such as whether each record has related records.
- 331f47b: Add `expr()` to queries of one value to apply operators to their value, such as `form.fields.count().expr().gt(3)`.
- e3fca0c: Use the value of another query in object conditions, operators, `in` lists, and the fallback of `coalesce`, such as `db.field.where({ formId: db.form.where({ name: "Feedback" }).get("id") })`.
- 4217081: Add `identifier` to name a table, a column, or another object known only at runtime in the templates of `sql`, `db.$query`, `db.$script`, `database.query`, and `database.script`.
- 836d47d: Interpolate a query into `sql`, `db.$query`, and `db.$script` as a subquery.

## 0.2.0

### Minor Changes

- 003d7d7: Add `db.$database` and `db.$schemaName`, which give the database that a `Db` is bound to and its PostgreSQL schema.
- 7bc3662: Add the `searchPath` option of `db.$transaction()` and `database.transaction()`, which sets the search path of the transaction; a nested transaction restores the search path of the enclosing one when it ends.

## 0.1.0

### Minor Changes

- ddf23b1: Initial release.
