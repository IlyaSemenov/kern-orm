# @kern-orm/migrations

## 0.3.1

### Patch Changes

- 7facf68: Accept every 0.x version of `kern-orm` from 0.3.0, so that upgrading `kern-orm` to a new minor version no longer needs a new version of `@kern-orm/migrations`.

## 0.3.0

### Minor Changes

- df9cf6d: The `new` command creates the first migration from a `createTable` template and later ones from an `addColumn` template.

### Patch Changes

- b4a8418: Fix helpers accepting an empty name, which failed only when the migration ran.
- 219ef99: Use the `kern-orm` of the application as a peer dependency instead of installing another copy when the versions differ.
- Updated dependencies: kern-orm@0.3.0

## 0.2.0

### Minor Changes

- d9b628d: Add the `count` option of `migrate`, which applies only the first pending migrations.
- d9b628d: Add the command line `@kern-orm/migrations/cli` with the commands `migrate`, `rollback`, `redo`, `status`, and `new`, which can also write the list of migration modules for Node.js and Bun.
- 5ee04f2: Add migration helpers for tables, columns, indexes, constraints, and extensions, plus utilities for custom helpers.
- 1545e8a: Add `verifyMigrations` and migration tests in `@kern-orm/migrations/testing`.

## 0.1.0

### Minor Changes

- c6b7a92: Initial release of the migrator, which applies, rolls back, and redoes migrations of PostgreSQL schemas and reports their status.
