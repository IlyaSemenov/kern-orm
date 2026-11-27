# Migrations

## A module without a migration

A migration is the default export of a module, plain values without runtime identity, and a module that does not export one rejects when it loads, rather than being recorded as applied.

- rake-db, fails: it collected the steps of `change()` in the state of its module, so a migration that called `change` of another copy of rake-db registered nothing, and migrating recorded it as applied ([orchid-orm#765](https://github.com/romeerez/orchid-orm/issues/765)).

## Histories with the same keys

Histories with the same keys never share migrations, since the cache of loaded modules is that of the runtime.

- rake-db, fails: it shared the changes of migrations of two histories under one key ([orchid-orm#764](https://github.com/romeerez/orchid-orm/issues/764)).

## State of a target

The table of versions of a target has a row for every key whose changes its schema has, and a call compares these keys with the keys of the history.

- Django, same: `django_migrations` has a row for every applied migration, removed when the migration is unapplied ([source](https://github.com/django/django/blob/6.0.10/django/db/migrations/recorder.py#L18-L19)).
- Rails, same: `schema_migrations` has a row for the version of every applied migration ([source](https://github.com/rails/rails/blob/v8.1.4.1/activerecord/lib/active_record/schema_migration.rb#L19-L34)).
- Alembic, differs: `alembic_version` keeps only the heads of the revisions, and a step replaces the revision of its row ([source](https://github.com/sqlalchemy/alembic/blob/rel_1_20_1/alembic/runtime/migration.py#L766-L809)).
- Drizzle ORM, differs: its table has a row for every applied migration, but the migrator reads the last row alone and applies the migrations of the journal created after it, comparing neither their hashes nor their names ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/dialect.ts#L88-L111)).
- Prisma ORM, differs: `_prisma_migrations` has a row for every attempt to apply a migration, with the checksum of its script and the times when it started, finished, and was rolled back ([source](https://github.com/prisma/prisma-engines/blob/7.10.1/schema-engine/connectors/sql-schema-connector/src/flavour/postgres.rs#L522-L537)).

## Replacing a history

A baseline, a migration without a key in the options of the history, takes a target without keys to the state of the migrations that it replaces and records their keys; a target that has the last of them needs nothing of it, and a target that has a part of them applies the rest while the history keeps their modules.

- Django, differs: `squashmigrations` writes a migration with a name of its own and `replaces` ([source](https://github.com/django/django/blob/6.0.10/django/core/management/commands/squashmigrations.py#L134-L200)).
  Applying it records the migrations that it replaces and then itself ([source](https://github.com/django/django/blob/6.0.10/django/db/migrations/executor.py#L268-L277)), every `migrate` records it on a database that has applied all of them ([source](https://github.com/django/django/blob/6.0.10/django/db/migrations/executor.py#L294-L308)), and a database that has applied a part of them keeps running the replaced migrations ([source](https://github.com/django/django/blob/6.0.10/django/db/migrations/loader.py#L250-L270)).
- MikroORM, differs: `migration:rollup` writes one migration of the `up` and `down` bodies of the executed migrations, replaces their rows with its own in the database that it is connected to, and deletes their files ([source](https://github.com/mikro-orm/mikro-orm/blob/v7.2.11/packages/core/src/utils/AbstractMigrator.ts#L148-L248)).
- Rails, differs: a new database loads the dump of the schema instead of running the migrations, and `Schema.define` records the version of the dump and the versions of the migration files before it ([source](https://github.com/rails/rails/blob/v8.1.4.1/activerecord/lib/active_record/connection_adapters/abstract/schema_statements.rb#L1397-L1416)); the files of old migrations can then be deleted ([docs](https://github.com/rails/rails/blob/v8.1.4.1/guides/source/active_record_migrations.md#L1662-L1667)).
- Alembic, differs: its cookbook creates the tables of a new database from the models and records the head with `stamp`, and then deletes the files of old revisions and sets `down_revision` of the earliest remaining one to `None` ([docs](https://github.com/sqlalchemy/alembic/blob/rel_1_20_1/docs/build/cookbook.rst#L17-L58)); a database whose recorded revision has no file fails ([source](https://github.com/sqlalchemy/alembic/blob/rel_1_20_1/alembic/script/base.py#L234-L239)).
- Prisma ORM, differs: its documentation deletes the directory of migrations, writes one migration with `migrate diff`, and marks it as applied on each existing database with `migrate resolve --applied` ([docs](https://github.com/prisma/docs/blob/7503f8376a127831ad15a4a46905b23a15369167/apps/docs/content/docs/orm/v7/prisma-migrate/workflows/squashing-migrations.mdx#L72-L116)); `migrate deploy` applies the directories that have no row of an applied migration, and accepts the rows of applied migrations that have no directory ([source](https://github.com/prisma/prisma-engines/blob/7.10.1/schema-engine/commands/src/commands/apply_migrations.rs#L26-L45)).
- node-pg-migrate, lacks: `fake` records migrations without running them ([source](https://github.com/salsita/node-pg-migrate/blob/v9.0.0/src/runner.ts#L116-L119)), and its check of the order rejects applied migrations whose names differ from those of the files at their positions ([source](https://github.com/salsita/node-pg-migrate/blob/v9.0.0/src/runner.ts#L368-L381)).
- TypeORM, lacks: `migration:run --fake` records migrations without running them ([docs](https://github.com/typeorm/typeorm/blob/1.1.3/docs/docs/migrations/08-faking.md#L1-L16)).
- Kysely, lacks: its `Migrator` rejects an executed migration that its provider lacks ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/migration/migrator.ts#L653-L665)).
- knex, lacks: it rejects applied migrations whose files are missing, unless `disableMigrationsListValidation` is set ([source](https://github.com/knex/knex/blob/3.3.0/lib/migrations/migrate/Migrator.js#L727-L745)).
- rake-db, lacks: `pull` writes a migration of an existing database and records it as applied ([source](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/packages/rake-db/src/generate/pull.ts#L27-L34)), and nothing replaces the migrations of a history; a request for squashing them was left open as nice to have ([orchid-orm#659](https://github.com/romeerez/orchid-orm/issues/659)).

## Rolling back a replaced history

A call that undoes every migration of a target undoes the replaced migrations together by the `down` of the baseline, and another call undoes a replaced migration by its own `down` while the history keeps its module.

- Django, differs: unapplying a squashed migration reverses its operations and removes its row and the rows of the migrations that it replaces ([source](https://github.com/django/django/blob/6.0.10/django/db/migrations/executor.py#L268-L292)), and migrating back to a replaced migration loads the graph without replacements while the files exist ([source](https://github.com/django/django/blob/6.0.10/django/db/migrations/executor.py#L42-L50)).
- MikroORM, differs: the migration of `migration:rollup` has the `down` bodies of the migrations in reverse order ([source](https://github.com/mikro-orm/mikro-orm/blob/v7.2.11/packages/core/src/utils/AbstractMigrator.ts#L148-L248)).
- Rails, differs: the dump of the schema has no `down`, and rolling back runs the `down` of a migration whose file is kept and whose version the load of the dump recorded ([source](https://github.com/rails/rails/blob/v8.1.4.1/activerecord/lib/active_record/migration.rb#L1469-L1478)).

## Migrating inside a transaction

`migrate` given the database of a transaction applies the migrations in that transaction, which commits or rolls them back.
It creates the schema and the table of versions that it found missing with `IF NOT EXISTS` under its lock, so that creating them does not fail when something else has created them meanwhile, which would abort an enclosing transaction.

- rake-db, fails: `migrate()` inside `$transaction` resolved after a logged `COMMIT`, but its changes were rolled back ([orchid-orm#702](https://github.com/romeerez/orchid-orm/issues/702)).
- rake-db, same: `migrate` runs on the adapter of the current transaction, where its own transaction is a savepoint ([source](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/packages/rake-db/src/commands/migrate-or-rollback.ts#L174-L183), [source](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/packages/pqb/src/adapters/adapter.ts#L810-L834)), and its documentation states that it starts no transaction inside one ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/migration-programmatic-use.md#L310)).
- Kysely, same: a `Migrator` given a transaction runs the migrations in it without `BEGIN` and `COMMIT` ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/migration/migrator.ts#L555-L569)), and takes and releases a session advisory lock in it ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/dialect/postgres/postgres-adapter.ts#L18-L39)).
- Drizzle ORM, lacks: `migrate` given a transaction runs the migrations by `transaction` of the session of the database rather than of the transaction ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/dialect.ts#L95-L111), [source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/db.ts#L56-L61)): on node-postgres, it sends `begin` and `commit` on the connection of the transaction ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/node-postgres/session.ts#L248-L268)), and on postgres.js, it calls `begin` of the client of the transaction, which that client lacks ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/postgres-js/session.ts#L175-L192)).
- Prisma ORM, lacks: Prisma Migrate applies migrations in a schema engine of its own, over a connection that the engine opens from the URL of the configuration ([source](https://github.com/prisma/prisma/blob/7.10.1/packages/migrate/src/Migrate.ts#L48-L55), [source](https://github.com/prisma/prisma/blob/7.10.1/packages/migrate/src/SchemaEngineCLI.ts#L389-L405)).
- node-pg-migrate, lacks: its runner sends `BEGIN` and `COMMIT` on the client of `dbClient` ([source](https://github.com/salsita/node-pg-migrate/blob/v9.0.0/src/runner.ts#L492-L507), [source](https://github.com/salsita/node-pg-migrate/blob/v9.0.0/src/migration.ts#L355-L378)).

## Migrating in a transaction of another library

`migrate` inside an external transaction of a database, or given the database of `runInExternalTransaction`, applies the migrations in a transaction of another library, on its connection that the library gives, such as of postgres.js or of Orchid ORM, or an object with `execute` and `executeScript` for another client.

- Drizzle ORM, lacks: `drizzle` of the client that `sql.begin` of postgres.js passes writes the parsers of `client.options`, which that client lacks ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/postgres-js/driver.ts#L22-L36)), and over a client of node-postgres in a transaction, `migrate` sends `begin` and `commit` on it ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/node-postgres/session.ts#L248-L268)).
- Kysely, lacks: its dialect of PostgreSQL takes a pool ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/dialect/postgres/postgres-dialect-config.ts#L68-L87)), and its driver begins and commits transactions on the connections of the pool ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/dialect/postgres/postgres-driver.ts#L77-L117)).
- Prisma ORM, lacks: Prisma Migrate connects by the URL of its configuration, which has no option of a driver adapter since Prisma ORM 7 ([docs](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference)).
- rake-db, lacks: `migrate` takes an instance of Orchid ORM or an adapter of pqb ([source](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/packages/rake-db/src/utils.ts#L3-L9)), which creates a pool of its own ([source](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/packages/pqb/src/adapters/adapter.ts#L335-L382)).
- node-pg-migrate, lacks: `dbClient` takes a client of node-postgres ([source](https://github.com/salsita/node-pg-migrate/blob/v9.0.0/src/runner.ts#L154-L165)), on which the runner sends `BEGIN` and `COMMIT`.

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
- Prisma ORM, differs: the schema engine runs each statement of a migration on its own, outside a transaction, so that `CREATE INDEX CONCURRENTLY` runs ([source](https://github.com/prisma/prisma-engines/blob/7.10.1/schema-engine/connectors/sql-schema-connector/src/flavour/postgres/connector/native/mod.rs#L150-L161)), and a migration that fails stays partly applied ([docs](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/patching-and-hotfixing)).

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

## Indexes that a failed concurrent build left

`createIndex` with `concurrently` checks the catalog before it builds: it drops an index of its name that is not valid, which a failed `CREATE INDEX CONCURRENTLY` leaves, and counts a valid one as built, which an attempt whose record failed has left.

- Drizzle ORM, lacks: Drizzle Kit builds an index with `concurrently` without checking for one of its name ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-kit/src/sqlgenerator.ts#L3543-L3549)), which `migrate` runs in its transaction, where PostgreSQL rejects it.
- Kysely, lacks: `createIndex()` has no concurrent build, and its `ifNotExists()` keeps an index that is not valid ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/schema/create-index-builder.ts#L43-L47)).
- Kysely 0.30.0-beta.2, differs: its documentation drops the index with `drop index concurrently if exists` before every build, since `IF NOT EXISTS` keeps an index that is not valid ([source](https://github.com/kysely-org/kysely/blob/v0.30.0-beta.2/site/docs/migrations.mdx?plain=1#L134-L171)).
- Django, lacks: `AddIndexConcurrently` builds without checking for an index of its name, so it fails on the index that a failed build left, and `RemoveIndexConcurrently` drops with `IF EXISTS` ([source](https://github.com/django/django/blob/6.0.10/django/db/backends/postgresql/schema.py#L21-L26)).
- node-pg-migrate, lacks: `createIndex` with `concurrently` and `ifNotExists` builds with `CREATE INDEX CONCURRENTLY IF NOT EXISTS`, which keeps an index that is not valid ([source](https://github.com/salsita/node-pg-migrate/blob/v9.0.0/src/operations/indexes/createIndex.ts#L74-L85)).
- Rails, fails: after a build failed with a lock timeout, `add_index` with `algorithm: :concurrently, if_not_exists: true` accepted the index that the build left not valid, and the issue was closed as not one of Rails ([source](https://github.com/rails/rails/blob/v8.1.4.1/activerecord/lib/active_record/connection_adapters/abstract/schema_creation.rb#L106-L122), [rails#52583](https://github.com/rails/rails/issues/52583)).
  A migration can check the index with `index_exists?(table, columns, valid: true)`, which `add_index` does not call ([source](https://github.com/rails/rails/blob/v8.1.4.1/activerecord/lib/active_record/connection_adapters/abstract/schema_statements.rb#L100-L105)).

## Parameters of a function

`createFunction` takes each parameter by its name as its type, or as an object of its type, mode, and default, and drops the function by the parameters without their defaults, which `DROP FUNCTION` rejects.

- node-pg-migrate, same: `createFunction` takes each parameter as a string or as an object of `mode`, `name`, `type`, and `default`, and its reverse `dropFunction` removes `default` of an object ([source](https://github.com/salsita/node-pg-migrate/blob/v9.0.0/src/operations/functions/dropFunction.ts#L25-L33)).

## Replacing a function

`replaceFunction` takes the definition before and after the change, replaces it with `CREATE OR REPLACE FUNCTION`, and restores the previous definition on rollback.

- node-pg-migrate, fails: `createFunction` with `replace: true` builds `CREATE OR REPLACE FUNCTION` ([source](https://github.com/salsita/node-pg-migrate/blob/v9.0.0/src/operations/functions/createFunction.ts#L82-L86)), and its reverse is `dropFunction` ([source](https://github.com/salsita/node-pg-migrate/blob/v9.0.0/src/operations/functions/createFunction.ts#L92)), so rolling back a migration that replaces a function drops it.

## Verifying a history

Verification applies each migration, rolls it back and requires the structure that the migration found, and applies it again.

- rake-db-testing, lacks: it checks only the applied versions after each step, so it misses a `down` that leaves a change that `up` makes again without an error, such as `SET NOT NULL` ([source](https://github.com/IlyaSemenov/rake-db-testing/blob/v0.3.0/src/verify-migrations.ts#L53)).

## Tables in migration tests

The callbacks of a migration test take the database of the migration, so their SQL names tables without a schema.

- rake-db-testing, differs: its scenarios name tables with `schemaRef` ([source](https://github.com/IlyaSemenov/rake-db-testing/blob/v0.3.0/src/migration-scenario.ts#L17)).

## Generating migrations and tables

The migrator applies migrations of SQL text, and generates neither migrations from tables nor tables from the database.

- Drizzle ORM, has: `drizzle-kit generate` generates migrations from tables, by their difference from the snapshot of the last migration ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-kit/src/cli/commands/migrate.ts#L302-L316)), and `drizzle-kit pull` tables from the database ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-kit/src/cli/commands/introspect.ts)).
- Prisma ORM, has: `prisma migrate dev` generates SQL migrations from the models ([docs](https://www.prisma.io/docs/cli/v7/migrate/dev)).
- Kysely, same: its `Migrator` applies migrations written by hand ([docs](https://github.com/kysely-org/kysely/blob/v0.29.8/site/docs/migrations.mdx)).
- kysely-codegen, has: it generates TypeScript types for Kysely from the database ([docs](https://github.com/RobinBlomberg/kysely-codegen/blob/0.20.0/README.md)).
- Orchid ORM, has: `db g` generates migrations from tables ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/generate-migrations.md)), and `db pull` tables from the database ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/migration-commands.md#pull)).

## Column types of migrations

Migrations and their helpers take SQL text.

- rake-db, has: `createTable` and `changeTable` take column types ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/migration-writing.md#createtable-droptable)).

## Commands around migrating

The application creates, drops, and resets its databases, and runs its own code around `migrate`.

- rake-db, has: commands that create, drop, or reset a database ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/migration-commands.md#create-and-drop-a-database)), `rebase` and `change-ids` of migrations ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/migration-commands.md#rebase)), and callbacks before and after migrating ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/migration-setup-and-overview.md#before-and-after-callbacks)).
