# Migrations

## Decisions

These hold for features that are not implemented yet.

### Package

- **Migrator** (`packages/migrations/`): `@kern-orm/migrations` applies, rolls back, and verifies histories of migrations.
  It is an official but replaceable migrator: `kern-orm` knows nothing of migrations, and another package must be able to implement migrations, their verification, and a command line with the public API of `kern-orm` alone.
- A need of the migrator that the public API of `kern-orm` does not cover becomes a general capability of `kern-orm`, never access to its internals, such as `$database` and `$schemaName` of a `Db` ([schemas](schemas.md)) and the search path of a transaction level ([transactions](transactions.md#settings)).
- The migrator runs everything through the `Database` of its target: transactions with `transaction`, scripts with `script`, and its own statements with `execute`, which returns text values, so that it decodes them without the types of `kern-orm`.
- Entry points:
  - the main one, without `node:*` imports, so that it bundles into an application: the migration format, histories, helpers, and running;
  - `@kern-orm/migrations/cli`: the command line;
  - `@kern-orm/migrations/testing`: the verification of histories and migration tests.

### Migrations

- Migrations are fixed artifacts: they never import the tables, the custom types, or the database of the application, so that a migration does the same on every target and in every later version of the application.
- A migration is the default export of a module: a step or an array of steps, plain values without runtime identity, which `defineMigration` only types.
  A module that does not export a migration rejects when it loads, rather than being recorded as applied.
  - rake-db 2.37.48 collects the steps of `change()` in the state of its module, so a migration that calls `change` of another copy of rake-db registers nothing, and migrating records it as applied ([orchid-orm#765](https://github.com/romeerez/orchid-orm/issues/765)).
- A step has `up` and an optional `down`, each a SQL script or a function of the database of the migration.
  - Applying runs `up` of the steps in their order, and rolling back runs `down` in reverse order, so that a step that depends on an earlier one, such as a table using a type, is undone before it.
  - A step without `down` does nothing on rollback, such as a change of data that cannot be undone.
- The database of a migration is `Pick<Database, "query" | "script">` of the target: its statements run in the transaction of the migration, and its unqualified names resolve in the target schema through the search path.
  It lacks the other members of `Database`, such as `close` and `bind`, which a migration must not use.

### Histories

- `defineMigrations` takes the loaders of the migration modules by key, or by path as `import.meta.glob` returns them, and options of the history: the name of its table of versions and the schemas that its search path lists after the target schema, such as the schema of extensions.
- A key is the file name without directories and extension, of the form `<number>_<name>`, and the number orders the history.
  `defineMigrations` rejects a key of another form and two keys of one number, such as migrations of two branches that took one number.
- A call loads only the migrations it applies or rolls back, so that migrating a target that is up to date loads none.
- The cache of loaded modules is that of the runtime, so histories with the same keys never share migrations.
  rake-db shared the changes of migrations of two histories under one key ([orchid-orm#764](https://github.com/romeerez/orchid-orm/issues/764)).
- Migrations of a history rely on the search path and do not name the target schema, so that one history applies to any schema, such as the schema of each tenant.

### Targets

- A target is a database and a PostgreSQL schema: a `Db`, which gives both, or a `Database`, so that a project that queries the database with another library can use kern-orm only to run its migrations.
- The `schemaName` option of a call overrides the PostgreSQL schema of the target, such as the schema of a tenant that is being created, which no context names yet.
- A call resolves the PostgreSQL schema once, at its start; without one, the target is `current_schema()`.

### Applying and rolling back

- Each target keeps the keys of its applied migrations, with the time of applying, in its table of versions in the target schema, `kern_migration` by default.
  Migrating creates the schema and the table when they are missing with `IF NOT EXISTS`, never by a statement that fails, which would abort an enclosing transaction ([orchid-orm#702](https://github.com/romeerez/orchid-orm/issues/702)).
- `migrate` applies the pending migrations of a target in one transaction and resolves to their keys.
  Inside a transaction, such as one that creates a tenant with its schema, or a test fixture, it runs as a nested level, so that its changes commit or roll back with the enclosing transaction.
- `migrate` first reads the table of versions outside a transaction and returns when nothing is pending, so that migrating a tenant at the first access of each process costs one statement.
  Otherwise, it locks the target with `pg_advisory_xact_lock` of a hash of the qualified name of its table of versions, reads the versions again, and applies those still pending, so that processes that migrate a target at once apply each migration once.
- The lock belongs to the target, so that different targets, such as tenants, migrate at once.
  rake-db 2.37.48 locks every target with one key, unless each configuration sets its own `migrationLockKey`, so a test run that migrates in a transaction blocks every other run until it ends ([orchid-orm#771](https://github.com/romeerez/orchid-orm/issues/771)).
- The search path of the level of the migrations is the target schema followed by the schemas of the history, and the level restores the previous search path when it ends.
- A target is up to date when its applied keys are the keys of the history, followed by keys after the last key of the history, if any, which a newer version of the application has applied, such as during a rolling deploy.
  `migrate` rejects an applied key that the history lacks before its last key, and a pending migration before an applied one.
- `rollback` undoes the last applied migrations of a target, one by default, a given number of them, or all, and `redo` undoes and applies them again, each in one transaction.
  They reject when the target has applied keys that the history lacks, since they cannot run the `down` of a migration they do not have.
- `getMigrationStatus` lists the applied and the pending keys of a target, and its applied keys that the history lacks.
- An error of a migration names its key and step, and keeps the original error in `cause`.

### Helpers

- Helpers build the steps of typical changes, as plain steps of SQL text with `up` and `down`, so that they combine in the array of a migration and users write their own the same way:
  - `createTable(table, definition)`, `dropTable(table, definition)`, and `renameTable(from, to)`;
  - `addColumn(table, column, definition)`, `dropColumn(table, column, definition)`, `renameColumn(table, from, to)`, and `changeColumn(table, column, from, to)`, whose states of the column, `{ type, using, notNull, default }`, give `ALTER COLUMN` of the properties that differ;
  - `createIndex(name, table, columns, options)` and `dropIndex` of the same arguments, with `unique`, `where`, `using`, and `include`;
  - `addConstraint(table, name, definition)`, `dropConstraint(table, name, definition)`, and `changeConstraint(table, name, from, to)`;
  - `createExtension(name, options)`, which creates an extension unless it exists and does nothing on rollback, since an extension belongs to the whole database.
- A helper that drops an object takes the definition that its `down` creates again.
- Definitions are SQL text; helpers quote the names they take and do not qualify them with a schema, which the search path gives.
- Indexes and constraints require names, since `down` drops them by name, and the names of the database stay those of the migration.
- The SQL that a helper builds never changes: applied migrations call the same helper, and a change of its SQL would change what they do on a new target.
  A new behavior requires a new helper or option.

### Command line

- `runMigrationCli(target, history, options)` runs the command of the arguments of the process on a target: `status`, `up [count]`, `down [count | all]`, `redo [count]`, and `new <name>`, which creates the module of the next migration in the directory of the options.
- `--schema` sets the PostgreSQL schema of the target; a `Db` whose PostgreSQL schema is a function, such as of the current tenant, requires it, since a command line has no context for the function.
- It is a function that a script of the project calls, so that the project runs it with its own runtime and module resolution, such as path aliases, rather than a binary that loads the configuration of the project.
- It does not close the database: the script that created the database owns it.

### Verification

- `verifyMigrations(target, history, options)` applies the whole history to a temporary schema, one migration at a time, in a transaction that always rolls back, nested in the enclosing one, such as a test transaction.
- For each migration, it applies `up` to the clean schema, and then, in a nested level that rolls back to keep the clean schema for the next migration, `down`, the migration tests of the migration, and `up` again.
- After `down`, the structure of the schema must be the same as before `up`, and after `up` again, the same as after the first `up`.
  The structure covers tables, columns, constraints, indexes, types, functions, and triggers, as `pg_catalog` describes them; it ignores the order of columns, since PostgreSQL cannot add a column at a position.
  Applying, rolling back, and applying again misses a `down` that leaves a change that `up` makes again without an error, such as `SET NOT NULL`, `SET DEFAULT`, or `CREATE INDEX IF NOT EXISTS`; comparing the structure catches it.
- A migration test checks how a migration changes existing data: `defineMigrationTest(name, { setup, assertUp, assertDown })` runs `setup` on the schema before the migration, then `up`, `assertUp`, `down`, `assertDown`, and `up` again.
  A test with `assertUpError`, instead of `assertUp` and `assertDown`, requires `up` to fail and checks its error.
  - Each test runs in its own nested level that rolls back, so tests do not affect each other or the history.
  - Its callbacks take the database of the migration, so that their SQL names tables without a schema, unlike the scenarios of [rake-db-testing](https://github.com/IlyaSemenov/rake-db-testing), which name them with `schemaRef`.
- The migration tests of a migration are the default exports, a test or an array of tests, of the files `<key>.migration-test.ts` and `<key>.<name>.migration-test.ts` beside it.
  `verifyMigrations` finds them in a directory or takes them as `import.meta.glob` returns them, and fails on a file of migration tests that matches no migration.
- An error names the migration, the migration test, and the step, and keeps the original error in `cause`.

### Not added

- Generating migrations from tables, as [`db g`](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/generate-migrations.md) of Orchid ORM 1.78.47 does, and generating tables from the database, as [`db pull`](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/migration-commands.md#pull) does: tables of kern-orm state what the database guarantees rather than describe its DDL.
- Column types of migrations, as `createTable` and `changeTable` of rake-db 2.37.48 take: migrations and helpers take SQL text, and the database names its constraints and indexes as the migration does.
- Commands that create, drop, or reset a database, or rename migrations, as `rebase` and `change-ids` of rake-db do, and callbacks before and after migrating: the application calls `migrate` and runs its own code around it.

## Open questions

- Migrations outside a transaction, such as `CREATE INDEX CONCURRENTLY`, which PostgreSQL rejects in a transaction block.
- Listing migrations without `import.meta.glob`, which Bun and bundlers such as Rollup lack: whether the command line writes the module of the loaders of a directory, so that users do not list migrations by hand.
- A command for every schema of a target whose PostgreSQL schema is a function, such as all tenants, from a list of schemas that the project gives.
- Recurrent SQL, such as functions and views that rake-db creates again after every migration ([docs](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/migration-setup-and-overview.md#recurrent-migrations)).
- Helpers of enums: PostgreSQL cannot drop a value of an enum, so undoing an added value creates the type again with the columns that use it.
- Isolation: reading the versions again after the lock sees the commit of another process only under `READ COMMITTED`, so decide what `migrate` does in a transaction of a stricter isolation level, which kern-orm does not start yet.
- Moving from rake-db: whether the migrator imports the applied versions of a rake-db table, of `version` and `name`, once, or projects convert them, and how a history whose earlier migrations a baseline of the schema replaces marks the baseline applied on existing targets.
- Checking tables against the database instead of generating migrations: a check, such as in tests after migrating, that each table of a schema exists with its columns and their nullability, that a constraint or a unique index backs each of its keys, and that a foreign key backs each required relation `one`.
