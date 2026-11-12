# kern-migrations

## 0.4.2

### Patch Changes

- Updated dependencies: kern-db@0.5.0

## 0.4.1

### Patch Changes

- 852a243: Validate the `schemaName` and `count` options before any query.
- Updated dependencies: kern-db@0.4.0

## 0.4.0

### Minor Changes

- 9deee7b: Reject a target that is not a `Db`, a database, or a driver with a `TypeError`, and add `isMigrationTarget`.

### Patch Changes

- Updated dependencies: kern-db@0.3.0

## 0.3.0

### Minor Changes

- 9bec4f3: Accept a driver of kern-db as the target of `migrate`, `rollback`, `redo`, `getMigrationStatus`, `runMigrationCli`, and `verifyMigrations`, without joining the transactions of the databases of the application or closing the driver.
- f833508: Add the migration helpers `createSequence`, `dropSequence`, `renameSequence`, and `changeSequence`.

### Patch Changes

- Updated dependencies: kern-db@0.2.0

## 0.2.0

### Minor Changes

- cb2e453: `migrate`, `rollback`, and `redo` reject in a transaction at `repeatable read` or `serializable` when they have migrations to run.
- 88ca2bf: `defineMigrations` accepts migrations directly, beside the loaders of their modules.

### Patch Changes

- 9ba1c07: Fix `migrate` failing with a duplicate key of `pg_namespace` when histories with different `tableName` create the same missing schema at once.
- 9be8828: Fix `migrate` failing on an extension of `createExtension` that another process has just created.

## 0.1.0

### Minor Changes

- 34e8302: Release `kern-migrations`, which replaces `@kern-orm/migrations`.
- 40ea523: Add `concurrently` to `createIndex` and `dropIndex`, which build and drop the index with `CREATE INDEX CONCURRENTLY` and `DROP INDEX CONCURRENTLY` when migrations run outside a transaction.
- eb6a163: Give the functions of migration steps `execute`, which runs a statement and returns its values as text.
- 34e8302: Require `kern-db` instead of `kern-orm`, and accept its databases as migration targets.
- 978666b: Add `outsideTransaction` to migration steps: changes, such as `CREATE INDEX CONCURRENTLY`, that `migrate`, `rollback`, and `redo` run outside a transaction when they are called outside one.
