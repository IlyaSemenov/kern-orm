# @kern-orm/migrations

## 0.2.0

### Minor Changes

- d9b628d: Add the `count` option of `migrate`, which applies only the first pending migrations.
- d9b628d: Add the command line `@kern-orm/migrations/cli` with the commands `migrate`, `rollback`, `redo`, `status`, and `new`, which can also write the list of migration modules for Node.js and Bun.
- 5ee04f2: Add migration helpers for tables, columns, indexes, constraints, and extensions, plus utilities for custom helpers.
- 1545e8a: Add `verifyMigrations` and migration tests in `@kern-orm/migrations/testing`.

## 0.1.0

### Minor Changes

- c6b7a92: Initial release of the migrator, which applies, rolls back, and redoes migrations of PostgreSQL schemas and reports their status.
