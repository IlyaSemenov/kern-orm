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
- Kysely, differs: it locks every migration of a database with one key ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/dialect/postgres/postgres-adapter.ts#L6)).
- node-pg-migrate, differs: it locks every migration of a database with one key, unless `lockValue` gives another ([source](https://github.com/salsita/node-pg-migrate/blob/v9.0.0/src/runner.ts#L223-L227)).
- Rails, differs: its lock belongs to the database, so a migration of one schema rejects while another schema migrates ([source](https://github.com/rails/rails/blob/v8.1.4.1/activerecord/lib/active_record/migration.rb#L1626-L1629)).

## Migrations outside a transaction

A step with `outsideTransaction` runs alone outside a transaction: the migrations before it commit first, the migrator records it after its change, and the migrations after it share a transaction of their own.

- rake-db, lacks: it runs every migration in a transaction, of the whole call or of each migration ([source](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/packages/rake-db/src/commands/migrate-or-rollback.ts#L67)).
- Drizzle ORM, fails: `migrate` ran every pending migration in one transaction, where PostgreSQL rejected `CREATE INDEX CONCURRENTLY`, and no migration could run outside it ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/dialect.ts#L95-L111), [drizzle-orm#860](https://github.com/drizzle-team/drizzle-orm/issues/860)).
- Kysely, differs: `disableTransactions` runs every migration of a call outside a transaction ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/migration/migrator.ts#L552-L579)).
- Django, differs: a migration with `atomic = False` runs outside a transaction, and every other migration in a transaction of its own ([source](https://github.com/django/django/blob/6.0.10/django/db/migrations/executor.py#L253-L262)).
- node-pg-migrate, same: a migration that calls `noTransaction()` commits the transaction of the migrations before it, runs outside a transaction, and starts a transaction for those after it ([source](https://github.com/salsita/node-pg-migrate/blob/v9.0.0/src/migration.ts#L355-L363)).
- Rails, differs: a migration with `disable_ddl_transaction!` runs outside a transaction, and every other migration in a transaction of its own ([source](https://github.com/rails/rails/blob/v8.1.4.1/activerecord/lib/active_record/migration.rb#L1594-L1604)).

## Migrations outside a transaction inside a transaction

In a transaction block, such as a transaction that creates a tenant, a test transaction, or the verification, a step with `outsideTransaction` runs its `up` and `down` instead, so that its history applies there.

- Django, differs: `AddIndexConcurrently` rejects in an atomic block, such as of an atomic migration or an enclosing `atomic` ([source](https://github.com/django/django/blob/6.0.10/django/contrib/postgres/operations.py#L114-L120)).
- Kysely, differs: a migrator given a transaction rejects `disableTransactions` ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/migration/migrator.ts#L555-L569)).

## Waiting for the lock of a target

Outside a transaction block, the migrator waits for the lock of a target by trying `pg_try_advisory_lock` in a session after pauses, since a process that waits in `pg_advisory_lock` keeps a snapshot, which `CREATE INDEX CONCURRENTLY` of the process that holds the lock waits for, so they deadlock.

- Kysely, differs: it waits in `pg_advisory_lock` of a session, with a `lock_timeout` of an hour ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/dialect/postgres/postgres-adapter.ts#L18-L32)).
- Kysely, fails: with `disableTransactions`, it took `pg_advisory_xact_lock` outside a transaction, which ended with its statement, so two migrators ran the same migration at once ([kysely#1894](https://github.com/kysely-org/kysely/issues/1894)).
- node-pg-migrate, differs: it rejects when another process holds the lock, or, with `advisoryLockMode: 'wait'`, waits in `pg_advisory_lock` ([source](https://github.com/salsita/node-pg-migrate/blob/v9.0.0/src/runner.ts#L223-L242)).
- Rails, differs: it rejects with `ConcurrentMigrationError` when another process holds the lock ([source](https://github.com/rails/rails/blob/v8.1.4.1/activerecord/lib/active_record/migration.rb#L1610-L1614)).
- Drizzle ORM, lacks: it took no lock, so calls of `migrate` at once applied each migration several times ([drizzle-orm#874](https://github.com/drizzle-team/drizzle-orm/issues/874)).

## Failures outside a transaction

The migrator records a migration outside a transaction after its change in a statement of its own, and the next `migrate` runs a change that failed again, so the change must be safe to run again.

- Kysely, same: with `disableTransactions`, it records a migration after its `up` ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/migration/migrator.ts#L757-L765)).
- Django, same: it records a migration with `atomic = False` after its operations ([source](https://github.com/django/django/blob/6.0.10/django/db/migrations/executor.py#L253-L262)).
- node-pg-migrate, same: it records a migration with `noTransaction()` after its steps ([source](https://github.com/salsita/node-pg-migrate/blob/v9.0.0/src/migration.ts#L353)).
- Rails, same: it records a migration with `disable_ddl_transaction!` after it runs ([source](https://github.com/rails/rails/blob/v8.1.4.1/activerecord/lib/active_record/migration.rb#L1544-L1547)).

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
