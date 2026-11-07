# kern-orm

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
