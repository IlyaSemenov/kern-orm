# kern-migrations

## 0.10.0

### Minor Changes

- 536d8bf: Add the `baseline` option of `defineMigrations`, which replaces the first migrations of a long history with one migration.

## 0.9.0

### Minor Changes

- 80be802: Add the migration helpers `addColumns()`, `dropColumns()`, `addConstraints()`, and `dropConstraints()`, which add or drop several columns or constraints of a table in one `ALTER TABLE`.
- 3515eb7: Add `changeColumns` to `alterTable`, which changes columns together with dropping and adding columns and constraints in one `ALTER TABLE`.
- 4c89b7f: Add the migration helper `alterTable()`, which drops and adds columns and constraints of a table in one `ALTER TABLE`.
- b702738: Add `changeColumns`, which changes several columns of a table in one `ALTER TABLE`.

### Patch Changes

- a12c6cc: Fix `createTable` and `createIndex` failing, and `changeColumn` skipping the changes after a `type` or `using`, when SQL given to them ends with a line comment before more SQL.

## 0.8.8

### Patch Changes

- Updated dependencies: kern-db@0.17.0

## 0.8.7

### Patch Changes

- Updated dependencies: kern-db@0.16.0

## 0.8.6

### Patch Changes

- Updated dependencies: kern-db@0.15.0

## 0.8.5

### Patch Changes

- Updated dependencies: kern-db@0.14.0

## 0.8.4

### Patch Changes

- Updated dependencies: kern-db@0.13.0

## 0.8.3

### Patch Changes

- Updated dependencies: kern-db@0.12.0

## 0.8.2

### Patch Changes

- Updated dependencies: kern-db@0.11.0

## 0.8.1

### Patch Changes

- Updated dependencies: kern-db@0.10.0

## 0.8.0

### Minor Changes

- 17c83d4: Add the `createFunction`, `dropFunction`, and `replaceFunction` migration helpers.

## 0.7.2

### Patch Changes

- Updated dependencies: kern-db@0.9.0

## 0.7.1

### Patch Changes

- Updated dependencies: kern-db@0.8.0

## 0.7.0

### Minor Changes

- 23f896d: Add the `createView`, `dropView`, and `replaceView` migration helpers.

### Patch Changes

- 0e48850: Fix migrations using a temporary table instead of the table with the same name in the target schema.

## 0.6.1

### Patch Changes

- Updated dependencies: kern-db@0.7.0

## 0.6.0

### Minor Changes

- 14cab7a: Add `createSingletonIndex` and `dropSingletonIndex`, which create and drop a unique index of `(true)` that keeps a table to at most one row.
- e7c4ba4: Add `singleton` to `createTable` and `dropTable`, which creates the table with its singleton index.

## 0.5.0

### Minor Changes

- ebcb27d: Add the migration helpers `createEnum(name, values)` and `dropEnum(name, values)`, which create and drop an enum type.

## 0.4.3

### Patch Changes

- Updated dependencies: kern-db@0.6.0

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
