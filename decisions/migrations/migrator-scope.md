# Capabilities the migrator does not add

`kern-migrations` applies, rolls back, and verifies histories of migrations of SQL text, and leaves other tasks to the application.

- Generating migrations from tables, as [`db g`](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/generate-migrations.md) of Orchid ORM does, and generating tables from the database, as [`db pull`](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/migration-commands.md#pull) does: tables of kern-orm state what the database guarantees rather than describe its DDL.
- Column types of migrations, as `createTable` and `changeTable` of rake-db take: migrations and helpers take SQL text, and the database names its constraints and indexes as the migration does.
- Commands that create, drop, or reset a database, or rename migrations, as `rebase` and `change-ids` of rake-db do, and callbacks before and after migrating: the application calls `migrate` and runs its own code around it.
- A command of the command line that verifies a history: migration tests need the assertions and the module resolution of the test runner, and a project adds such a command by handling its arguments before `runMigrationCli`.
