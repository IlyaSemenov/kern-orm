# Migrations

## A module without a migration

A migration is the default export of a module, plain values without runtime identity, and a module that does not export one rejects when it loads, rather than being recorded as applied.

- rake-db, fails: it collected the steps of `change()` in the state of its module, so a migration that called `change` of another copy of rake-db registered nothing, and migrating recorded it as applied ([orchid-orm#765](https://github.com/romeerez/orchid-orm/issues/765)).

## Histories with the same keys

Histories with the same keys never share migrations, since the cache of loaded modules is that of the runtime.

- rake-db, fails: it shared the changes of migrations of two histories under one key ([orchid-orm#764](https://github.com/romeerez/orchid-orm/issues/764)).

## Migrating inside a transaction

`migrate` creates the schema and the table of versions that it found missing with `IF NOT EXISTS` under its lock, so that creating them does not fail when something else has created them meanwhile, which would abort an enclosing transaction.

- rake-db, fails: `migrate()` inside `$transaction` resolved after a logged `COMMIT`, but its changes were rolled back ([orchid-orm#702](https://github.com/romeerez/orchid-orm/issues/702)).

## Locks of targets

The lock of migrating belongs to the target, so that different targets, such as tenants, migrate at once.

- rake-db, fails: it locked every target with one key, unless each configuration set its own `migrationLockKey`, so a test run that migrated in a transaction blocked every other run until it ended ([orchid-orm#771](https://github.com/romeerez/orchid-orm/issues/771)).

## Verifying a history

Verification applies each migration, rolls it back and requires the structure that the migration found, and applies it again.

- rake-db-testing, lacks: it checks only the applied versions after each step, so it misses a `down` that leaves a change that `up` makes again without an error, such as `SET NOT NULL` ([source](https://github.com/IlyaSemenov/rake-db-testing/blob/v0.3.0/src/verify-migrations.ts#L53)).

## Tables in migration tests

The callbacks of a migration test take the database of the migration, so their SQL names tables without a schema.

- rake-db-testing, differs: its scenarios name tables with `schemaRef` ([source](https://github.com/IlyaSemenov/rake-db-testing/blob/v0.3.0/src/migration-scenario.ts#L17)).

## Generating migrations and tables

The migrator applies migrations of SQL text, and generates neither migrations from tables nor tables from the database.

- Orchid ORM, has: `db g` generates migrations from tables ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/generate-migrations.md)), and `db pull` tables from the database ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/migration-commands.md#pull)).

## Column types of migrations

Migrations and their helpers take SQL text.

- rake-db, has: `createTable` and `changeTable` take column types ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/migration-writing.md#createtable-droptable)).

## Commands around migrating

The application creates, drops, and resets its databases, and runs its own code around `migrate`.

- rake-db, has: commands that create, drop, or reset a database ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/migration-commands.md#create-and-drop-a-database)), `rebase` and `change-ids` of migrations ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/migration-commands.md#rebase)), and callbacks before and after migrating ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/migration-setup-and-overview.md#before-and-after-callbacks)).
