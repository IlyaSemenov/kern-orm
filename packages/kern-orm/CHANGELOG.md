# kern-orm

## 0.2.0

### Minor Changes

- 003d7d7: Add `db.$database` and `db.$schemaName`, which give the database that a `Db` is bound to and its PostgreSQL schema.
- 7bc3662: Add the `searchPath` option of `db.$transaction()` and `database.transaction()`, which sets the search path of the transaction; a nested transaction restores the search path of the enclosing one when it ends.

## 0.1.0

### Minor Changes

- ddf23b1: Initial release.
