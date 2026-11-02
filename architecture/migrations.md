# Migrations

- **Migrator** (`packages/migrations/`): `@kern-orm/migrations` applies and rolls back histories of migrations.
  It is an official but replaceable migrator: `kern-orm` knows nothing of migrations, and another package must be able to implement migrations, their verification, and a command line with the public API of `kern-orm` alone.
- A need of the migrator that the public API of `kern-orm` does not cover becomes a general capability of `kern-orm`, never access to its internals, such as `$database` and `$schemaName` of a `Db` ([schemas](schemas.md)) and the search path of a transaction level ([transactions](transactions.md#settings)).
  The migrator imports only types from `kern-orm`.
- The migrator runs everything through the `Database` of its target: transactions with `transaction`, scripts with `script`, and its own statements with `execute`, which returns text values, so that it decodes them without the types of `kern-orm`.
- The main entry point has no `node:*` imports, so that it bundles into an application: the migration format, histories, running, and helpers.
  The entry point `@kern-orm/migrations/cli` holds the [command line](#command-line), and `@kern-orm/migrations/testing` the [verification](#verification), which import `node:*` modules.

## Migrations

- Migrations are fixed artifacts: they never import the tables, the custom types, or the database of the application, so that a migration does the same on every target and in every later version of the application.
- A migration is the default export of a module: a step or a non-empty array of steps, plain values without runtime identity, which `defineMigration` only types.
  A module that does not export a migration rejects when it loads, rather than being recorded as applied.
  - rake-db 2.37.48 collects the steps of `change()` in the state of its module, so a migration that calls `change` of another copy of rake-db registers nothing, and migrating records it as applied ([orchid-orm#765](https://github.com/romeerez/orchid-orm/issues/765)).
- A step has `up` and an optional `down`, each a SQL script or a function of the database of the migration, and no other properties, so that a misspelled `down` rejects when the migration loads instead of doing nothing on rollback.
  Blank SQL text, such as of the template of `new`, rejects too, so that a migration left blank is never recorded as applied.
  - Applying runs `up` of the steps in their order, and rolling back runs `down` in reverse order, so that a step that depends on an earlier one, such as a table using a type, is undone before it.
  - A step without `down` does nothing on rollback, such as a change of data that cannot be undone.
- The database of a migration is `Pick<Database, "query" | "script">` of the target: its statements run in the transaction of the migration, and its unqualified names resolve in the target schema through the search path.
  It lacks the other members of `Database`, such as `close` and `bind`, which a migration must not use.

## Histories

- `defineMigrations` takes the loaders of the migration modules by key, or by path as `import.meta.glob` returns them, and options of the history: the name of its table of versions and the schemas that its search path lists after the target schema, such as the schema of extensions.
- A key is the file name without directories and extension, of the form `<number>_<name>` without dots, and the number orders the history as an integer.
  A name of a loader that contains `/` is a path; another name is the key itself.
  `defineMigrations` rejects a key of another form and two keys of one number, such as `0002_create_user` and `2_create_tag`, or migrations of two branches that took one number.
- `defineMigrations` rejects a path of a file of [migration tests](#verification) with a hint to exclude migration tests from the patterns of `import.meta.glob`, rather than skipping it: a bundler builds a chunk of every module that the patterns match, with its imports, such as the test runner.
- A call loads only the migrations it applies or rolls back, so that migrating a target that is up to date loads none.
  It loads them all before running any, so that a module that fails to load changes nothing.
- The cache of loaded modules is that of the runtime, so histories with the same keys never share migrations.
  rake-db shared the changes of migrations of two histories under one key ([orchid-orm#764](https://github.com/romeerez/orchid-orm/issues/764)).
- Migrations of a history rely on the search path and do not name the target schema, so that one history applies to any schema, such as the schema of each tenant.

## Targets

- A target is a database and a PostgreSQL schema: a `Db`, which gives both, or a `Database`, so that a project that queries the database with another library can use kern-orm only to run its migrations.
  A target is typed by the members `$database` and `$schemaName` of a `Db`, so that checking a `Db` against it compares no queries.
- The `schemaName` option of a call overrides the PostgreSQL schema of the target, such as the schema of a tenant that is being created, which no context names yet.
- A call resolves the PostgreSQL schema once, at its start, calling the function of `schemaName` of a `Db` at most once; without one, the target is `current_schema()`, and a call rejects when it is `NULL`.

## Applying and rolling back

- Each target keeps the keys of its applied migrations, with the time of applying, in its table of versions in the target schema, `kern_migration` by default, with columns `key` and `applied_at`.
- Every call first resolves the target schema and checks that it and its table of versions exist, then reads the table only when it exists, since a statement on a missing table would fail and abort an enclosing transaction.
  It checks them with a query of `pg_catalog` rather than with `to_regclass` and `to_regnamespace`, whose lookups in the catalog cache of the connection miss a schema that another transaction committed while this one waited for the lock of the target.
  It rejects a target schema or a table of versions whose name is longer than `max_identifier_length` bytes before changing anything, since PostgreSQL truncates such a name, and the check would miss what the migrator created under it.
- `migrate` applies the pending migrations of a target, or the first `count` of them, in one transaction and resolves to their keys.
  Inside a transaction, such as one that creates a tenant with its schema, or a test fixture, it runs as a nested level, so that its changes commit or roll back with the enclosing transaction.
- `migrate` returns after the first read when nothing is pending, so that migrating a tenant that is up to date at the first access of each process costs two statements outside a transaction.
  Otherwise, it locks the target with `pg_advisory_xact_lock` of `hashtextextended` of the qualified name of its table of versions, reads the versions again, and applies those still pending, so that processes that migrate a target at once apply each migration once.
- Under the lock, `migrate` creates the schema and the table of versions that the read found missing, with `IF NOT EXISTS`, so that no statement fails when something other than the migrator has created them meanwhile, which would abort an enclosing transaction ([orchid-orm#702](https://github.com/romeerez/orchid-orm/issues/702)).
  Creating only what is missing keeps PostgreSQL from sending a notice of an existing schema, which postgres.js logs by default.
- The lock belongs to the target, so that different targets, such as tenants, migrate at once.
  rake-db 2.37.48 locks every target with one key, unless each configuration sets its own `migrationLockKey`, so a test run that migrates in a transaction blocks every other run until it ends ([orchid-orm#771](https://github.com/romeerez/orchid-orm/issues/771)).
- The search path of the level of the migrations is the target schema followed by the schemas of the history, and the level restores the previous search path when it ends.
- A target is up to date when its applied keys are the keys of the history, followed by keys after the last key of the history, if any, which a newer version of the application has applied, such as during a rolling deploy.
  `migrate` rejects an applied key that the history lacks before its last key or that is not of the form of a key, and a pending migration before an applied one.
- `rollback` undoes the last applied migrations of a target, one by default, a given number of them, or all, and `redo` undoes and applies them again, each in one transaction that locks the target.
  They resolve to the keys in the order they undo and apply them, and to none without a transaction when the target has no table of versions.
  They reject when the target has applied keys that the history lacks, since they cannot run the `down` of a migration they do not have.
- `getMigrationStatus` gives the PostgreSQL schema that it resolved, the applied and the pending keys of the target, and its applied keys that the history lacks, as `unknown`.
- An error of a migration is a `MigrationError` that names its key, and its step and direction for an error of a step, and keeps the original error in `cause`.
  Its message includes the message of the original error, since not every log shows `cause`.

## Helpers

- Helpers (`src/helpers/`) build steps of typical changes, such as `createTable` and `changeColumn`, as plain steps of SQL text, so that they combine in the array of a migration with steps of its own.
- A project writes its own helpers with the public primitives that the built-in helpers use:
  - `quoteIdentifier` and `quoteLiteral`; `quoteLiteral` matches `quote_literal` of PostgreSQL, doubling quotes and backslashes and prefixing `E` to a value with a backslash, so that a literal keeps its value whatever `standard_conforming_strings` is;
  - `invertStep`, which swaps `up` and `down` and rejects a step without `down`;
  - `combineSteps`, which makes one step that runs the `up` of the steps in order and the `down` of those that have one in reverse order.
    Changes of a direction that are all SQL text join into one script with each semicolon on a line of its own, so that a script that ends with a line comment does not comment it out; other changes run in order from a function.
  - `invertStep` and `combineSteps` reject a value that is not a step, as loading a migration does, since the step they return would hide a problem such as a misspelled `down`.
- The SQL that a helper builds never changes: applied migrations call the same helper on new targets, and a change of its SQL would change what they do there.
  A new behavior requires a new helper or option; the helpers of a project must follow the same rule.
- Helpers quote the names they take as arguments or keys and never qualify them with a schema, which the search path of the migration gives.
  They insert SQL text, such as definitions, conditions, defaults, and the elements of an index, as it is.
- They add no `IF EXISTS`, `IF NOT EXISTS`, or `CASCADE`, except `createExtension`, so that a `down` that does not match its `up` fails instead of passing or dropping dependent objects.
- A helper checks its arguments when it is called, that is, when the module of its migration loads, so that a mistake it finds fails the migration before anything runs; PostgreSQL checks the SQL text that it takes when the step runs.
  `quoteIdentifier` rejects an empty name, so that a name left blank fails when the migration loads.
- A helper that drops an object is `invertStep` of the helper that creates it, with the same arguments, which give the definition that its `down` creates again.
  Dropping a table or a column also drops its indexes and constraints, and the definition restores only what it describes, so a migration must drop standalone indexes and constraints with their own steps before, and describe each constraint once.
- `changeColumn` takes the states of a column before and after the change, which list the same of `type`, `notNull`, and `default`, so that a missing property never means a value; `using` of a state converts the values to its type.
  It builds one `ALTER TABLE` of the actions of the properties that differ.
  When the type changes, it drops a default that the states list before the type and sets it after, since PostgreSQL otherwise casts the old default to the new type and fails, such as `''` of `text` to `integer`.
  In one `ALTER TABLE`, PostgreSQL drops a default before it changes the type and sets one after, whatever the order of the actions.
- `createIndex` without `name` names the index as PostgreSQL names an index without a name, `<table>_<columns>_idx` of its key and `include` columns, so that `dropIndex` also finds an index that SQL created without a name.
  - It requires `name` when PostgreSQL would name the index otherwise: for an element that is not a lowercase column with an optional ordering, such as an expression, which PostgreSQL names `expr`; for a repeated column, which PostgreSQL numbers; and for a name longer than 63 bytes, which PostgreSQL truncates.
  - It reads an element as PostgreSQL does: words separated by the whitespace of SQL only, since PostgreSQL reads another space, such as U+00A0, as a character of a name, and the keywords of an ordering in ASCII letters of any case.
  - It never appends the number that PostgreSQL appends to a name that exists, so that a collision fails.
  - Elements of `include` must be columns, since PostgreSQL accepts neither expressions nor orderings there.
- `createExtension` has no `down`, since an extension belongs to the whole database, such as to every tenant.
  - It checks `pg_extension` in a `DO` block rather than running `CREATE EXTENSION IF NOT EXISTS`, which sends a notice of an existing extension that postgres.js logs, at every new tenant of a history that creates one.
  - When the extension is missing, it takes a transaction-level advisory lock and checks again, so that migrations of different targets that create one extension at once wait for each other instead of failing on the unique index of `pg_extension`.
    The second check sees an extension that another transaction committed meanwhile under `READ COMMITTED`, since each statement of the block takes a new snapshot.
  - With `schema`, it creates that schema under the lock when it is missing, before the extension, and keeps it on rollback, since it belongs to the whole database as the extension does.
    It checks `pg_namespace` before `CREATE SCHEMA IF NOT EXISTS`, which would send a notice of an existing schema, and keeps `IF NOT EXISTS` for a schema that something other than a migration has created meanwhile.
  - One key locks all extensions, so that histories that create several extensions in different orders do not deadlock.
    A transaction that migrates several targets holds the lock until it ends, so it can deadlock with a process that migrates one of them and creates another missing extension; PostgreSQL detects the deadlock and fails one transaction, as for two transactions that migrate the same targets in different orders.
  - The body of the block is quoted with a dollar tag that the names do not contain.
  - Without `schema`, the extension goes to the target schema, and the migrations of another schema miss it once it exists; a history that applies to several schemas, such as of tenants, or to the schema of the verification, must pass a schema of its own and list it in its `searchPath`.

## Command line

- `runMigrationCli(target, history, options)` runs the command of the arguments of the process, or of `args`, on a target: `migrate [count]`, `rollback [count | all]`, `redo [count]`, `status`, and `new <name>`, named as the functions they call.
- It is a function that a script of the project calls, so that the project runs it with its own runtime and module resolution, such as path aliases, rather than a binary that loads the configuration of the project.
  A project adds commands of its own by handling its arguments before the call and passing the rest in `args`.
- It does not close the database: the script that created the database owns it.
  It never rejects: it prints an error to stderr and sets `process.exitCode` to 1, so that the script closes the database after it.
  - A usage error prints its message with a hint to `--help`; arguments without a command print the usage to stderr.
  - An error of a command prints whole with `console.error`, with its stack, `cause`, and the fields of a PostgreSQL error, such as `detail`.
- `--schema` sets the PostgreSQL schema of the target.
  Otherwise, the command line reads `$schemaName` of a `Db` once, before the command, and passes the call the `Database` of the target with that `schemaName`, so that the call does not read it again.
  When the function of the schema throws, such as of the current tenant, which a command line has no context for, the error names `--schema`.
- `new <name>` creates the module of the next migration in `directory`, and never overwrites a file.
  - `<name>` has only letters, digits, `_`, and `-`, so that it makes a key, a file name on every file system, and an import specifier.
  - Its number follows the greatest number of the keys of the history and of the migration modules of the directory, with as many digits as the key of that number.
  - The migration modules of a directory are its files of `.ts`, `.mts`, `.js`, or `.mjs` whose name without the extension is a key, so that `index.ts` and migration tests `<key>.migration-test.ts` are not; two modules of one number are an error.
  - The default template has blank `up` and `down`, which fail to load until they are filled in.
- With `listModule`, `new` also writes a module whose default export is the loaders of the migration modules of the directory by key, for `defineMigrations` on runtimes without `import.meta.glob`, such as Node.js and Bun.
  - Its import specifiers are relative to the list module, which may be inside the directory or outside it.
    They keep the extensions of the module files, which Node.js requires, unless `extensions` is `false`, for projects that import without extensions through a bundler.
  - A specifier with `#`, `?`, or `%` is an error rather than escaped: Node.js reads a specifier as a URL, and Bun and bundlers read it as a path.
  - `new` writes only a list module that starts with its header line, whatever its line endings, so that it never overwrites a module written by hand; a project creates the list with that line before its first migration, since its script imports the list, and adds the line to a list written by hand to let `new` write it.
  - The list module must not be named as a migration, whose module it would replace.
  - The list module and the migration modules must be on the same Windows drive, since a module on another drive has no relative specifier.
  - `new` checks the list module and builds its text before it creates the migration, so that these errors write nothing.
    It writes the list from the modules of the directory listed again after it creates the migration, so that the list keeps a migration that another `new` has created meanwhile, and two migrations of one number fail.

## Verification

- `verifyMigrations(target, history, options)` (`src/verification/`) checks a history in a temporary schema of the database of its target, whose schema it ignores, in a transaction that always rolls back, nested in the enclosing one, such as a test transaction.
  - The temporary schema is `kern_verify_` with 12 random hexadecimal digits, so that verifications in parallel test processes do not wait for each other on the unique index of `pg_namespace`.
  - Its search path is the temporary schema followed by the schemas of the history, as `migrate` gives a target.
- Before any statement, it rejects a history without migrations, which more likely comes from a pattern that matches no file than from a project without migrations, loads the migration tests, rejecting a file of tests that matches no migration, and loads every migration.
- It verifies the migrations in the order of the history, each on the schema that the migrations before it leave:
  1. It applies the migration and describes the structure of the schema.
  2. In a nested level that rolls back, it rolls the migration back and requires the structure that the migration found; runs each migration test of the migration in a nested level of its own that rolls back; and applies the migration again.
  - The structure after the second `up` goes unchecked: from the structure that the first `up` found, `up` builds the same one unless it depends on something else, such as data, so the verification describes the schema twice for each migration rather than three times.
  - Applying, rolling back, and applying again misses a `down` that leaves a change that `up` makes again without an error, such as `SET NOT NULL`, `SET DEFAULT`, or `CREATE INDEX IF NOT EXISTS`; comparing the structure catches it.
    [rake-db-testing](https://github.com/IlyaSemenov/rake-db-testing) 0.3.0 checks only the applied versions after each step.
- It rejects at the first failure.
  `up` and `down` of a migration reject with their `MigrationError`; a structure that differs lists the lines before the migration that the rollback lost, with `-`, and those that it left, with `+`; a second `up` that fails names the migration and keeps its error in `cause`.
- The structure (`src/verification/structure.ts`) is lines of text of the objects of the schema that `pg_catalog` gives: tables, columns, constraints, indexes, views, sequences, types, functions, triggers, rules, policies, statistics, and collations, with the owners other than the role that runs the verification, which owns the objects of the migrations, and the privileges that differ from the defaults.
  - The verification reads the role before the migrations run, since a migration may set another role, which would hide a change of owner to it.
  - The lines of columns do not tell their order, since PostgreSQL adds a column only at the end, so that a column that a rollback adds back matches.
  - It leaves out the objects of extensions, which `createExtension` keeps on rollback, including a composite type, whose type rather than relation belongs to the extension, and the objects that another object creates with itself, such as the array type of a type and the constructors of a range type.
  - It sorts the items of ACLs and the options of tables, whose order follows the order of their changes, so that a rollback that restores them matches.
  - It compares an ACL with the default ACL of its object, since a grant and its revoke leave an explicit ACL of the default items, and keeps an ACL that grants nothing apart from the default one.
  - Definitions name the schemas that the search path lacks, so two descriptions compare only under one search path.
- A migration test checks how a migration changes existing data: `defineMigrationTest(name, { setup, assertUp, assertDown })` runs `setup` on the schema before the migration, then `up`, `assertUp`, `down`, `assertDown`, and `up` again.
  A test with `assertUpError`, instead of `assertUp` and `assertDown`, requires `up` to fail, and its callback receives the `MigrationError` of `up`.
  - `up` of such a test runs in a nested level, so that `assertUpError` queries the data after the failure.
  - A test is a plain value, like a migration, and its file is a fixed artifact that must not import the tables of the application.
  - Its callbacks take the database of the migration, so that their SQL names tables without a schema, unlike the scenarios of rake-db-testing, which name them with `schemaRef`.
  - `defineMigrationTest`, and loading a file of tests, reject an unknown property, such as a misspelled `assertDown`, which would never run, `assertUpError` together with `assertUp` or `assertDown`, and a test without callbacks.
  - An error of a test names the test, its file, and the stage that failed, such as `assertUp`, and keeps the original error in `cause`.
- The migration tests of a migration are the default exports, a test or a non-empty array of tests, of the files `<key>.migration-test.<extension>` and `<key>.<name>.migration-test.<extension>` beside it, with the extensions of migration modules.
  - `tests` of `verifyMigrations` is their directory, whose other files it skips, or their modules or loaders by path, as `import.meta.glob` returns them, whose paths must name files of migration tests.
  - The tests of a migration run in the order of the names of their files, and of the tests in a file.
  - It imports the files of a directory by their `file:` URLs with the loader of the runtime, such as of Node.js or Bun; under Vitest, the loaders of `import.meta.glob` let Vite transform the files as it transforms test files, such as with the aliases of its configuration.
  - The suffix `.migration-test` keeps the default patterns of `bun test` and Vitest from running such a file as a test file; `node --test` without patterns runs it as a file without tests.

## Not added

- Generating migrations from tables, as [`db g`](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/generate-migrations.md) of Orchid ORM 1.78.47 does, and generating tables from the database, as [`db pull`](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/migration-commands.md#pull) does: tables of kern-orm state what the database guarantees rather than describe its DDL.
- Column types of migrations, as `createTable` and `changeTable` of rake-db 2.37.48 take: migrations and helpers take SQL text, and the database names its constraints and indexes as the migration does.
- Commands that create, drop, or reset a database, or rename migrations, as `rebase` and `change-ids` of rake-db do, and callbacks before and after migrating: the application calls `migrate` and runs its own code around it.
- A command of the command line that verifies a history: migration tests need the assertions and the module resolution of the test runner, and a project adds such a command by handling its arguments before `runMigrationCli`.

## Open questions

- Isolation: reading the versions again after the lock sees the commit of another process only under `READ COMMITTED`, so decide what `migrate` does in a transaction of a stricter isolation level, which kern-orm does not start yet.
