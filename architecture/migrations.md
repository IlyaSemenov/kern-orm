# Migrations

- **Migrator** (`packages/migrations/`): `kern-migrations` applies and rolls back histories of migrations.
  It is an official but replaceable migrator: `kern-db` and `kern-orm` know nothing of migrations, and another package must be able to implement migrations, their verification, and a command line with the public API of `kern-db` alone.
  It leaves to the application generating migrations from tables and tables from the database, column types of migrations, commands that create, drop, or reset a database or rename migrations, callbacks around migrating, and a command that verifies a history ([decision](../decisions/migrations/migrator-scope.md)).
- A need of the migrator that the public API of `kern-db` and `kern-orm` does not cover becomes a general capability of their package, never access to its internals, such as `$database` and `$schemaName` of a `Db` ([schemas](schemas.md)) and the search path of a transaction level ([transactions](transactions.md#settings)).
- The migrator requires `kern-db` by a peer dependency.
  It imports nothing of `kern-orm`, also in types, and takes a `Db` by its members `$database` and `$schemaName`; `packages/db/tests/boundaries.test.ts` checks the imports of its sources.
- The migrator runs everything through the `Database` of its target: transactions with `transaction`, sessions with `session`, scripts with `script`, and its own statements with `execute`, which returns text values, so that it decodes them without the types of `kern-db/types`, which a database of another copy of `kern-db` does not take.
- The main entry point has no `node:*` imports, so that it bundles into an application: the migration format, histories, running, and helpers.
  The entry point `kern-migrations/cli` holds the [command line](#command-line), and `kern-migrations/testing` the [verification](#verification), which import `node:*` modules.

## Compatibility

The migrator follows the [contract of package compatibility](compatibility.md), and relies on `execute`, `query`, `script`, `transaction`, `session`, `isInTransactionBlock`, `lock`, `pollLock`, and `close` of the `Database` of `kern-db`, `$database` and `$schemaName` of a `Db` of `kern-orm`, `createDatabase` and `isDriver` of `kern-db`, and the types of their options and results that it uses, such as the `searchPath` option of transactions and sessions and the text values of `execute`.

## Migrations

- Migrations are fixed artifacts: they never import the tables, the custom types, or the database of the application, so that a migration does the same on every target and in every later version of the application.
- A migration is a step or a non-empty array of steps, plain values without runtime identity, which `defineMigration` only types.
  It is the default export of a module, or a value that a [history](#histories) takes directly.
  A module that does not export a migration rejects when it loads, rather than being recorded as applied.
- A step has `up`, an optional `down`, and optional [changes outside a transaction](#changes-outside-a-transaction), each change a SQL script or a function of the database of the migration, and no other properties, so that a misspelled `down` rejects before the migration runs instead of doing nothing on rollback.
  Blank SQL text rejects too, so that a migration left blank is never recorded as applied.
  - Applying runs `up` of the steps in their order, and rolling back runs `down` in reverse order, so that a step that depends on an earlier one, such as a table using a type, is undone before it.
  - A step without `down` does nothing on rollback, such as a change of data that cannot be undone.
- The database of a migration is `Pick<Database, "query" | "script" | "execute">` of the target: its statements run in the transaction of the migration, or, for a change outside a transaction, each in a transaction of its own on the connection of the session, and its unqualified names resolve in the target schema through the search path.
  It lacks the other members of `Database`, such as `close`, which a migration must not use.
  Its `query` and `script` are of the [database layer](README.md#layers): their templates take the SQL fragments of `kern-db`, and `query` decodes rows by types, such as of `kern-db/types`.

### Changes outside a transaction

- `outsideTransaction` of a step has `up`, `down`, or both: the changes that a call outside a transaction block runs instead of `up` and `down` of the step, for statements that PostgreSQL rejects in a transaction block, such as `CREATE INDEX CONCURRENTLY`.
  A direction without a change there runs in a transaction, as the changes of other steps do.
  - Such a change sends each statement that PostgreSQL rejects in a transaction block in a call of its own, since PostgreSQL runs a script of several statements in one transaction.
- In a transaction block, the step runs `up` and `down`, so that every migration applies inside an enclosing transaction, such as one that creates a tenant, in a test transaction, and in the [verification](#verification) ([decision](../decisions/migrations/transactional-form.md)).
  So the step requires `up` as every step does, and `outsideTransaction.down` requires `down`, which undoes the step in a transaction block.
  `up` and `down` must build the same objects, with the same names, as the changes outside a transaction, since later migrations rely on them whichever form ran.
- A step with `outsideTransaction` must be the only step of its migration, and the migrator records no progress of the steps of a migration ([decision](../decisions/migrations/outside-transaction-step.md)).
- The migrator records the migration in a statement of its own after the change, so a change outside a transaction must be safe to run again: after it fails, and after it succeeds but the record of its migration fails to change.

## Histories

- `defineMigrations` takes the migrations by key, or by path as `import.meta.glob` returns them, and options of the history: the name of its table of versions and the schemas that its search path lists after the target schema, such as the schema of extensions.
  - A function is the loader of a migration module, and another value is the migration itself, which lets a package define its migrations without a module for each and a chunk for each in a bundle.
  - `defineMigrations` checks the steps of a migration given as a value when it is called, as a helper checks its arguments, and the default export of a module when its loader runs; PostgreSQL checks SQL text only when the step runs.
    It rejects a value that is neither a loader nor a migration, such as an empty array.
- A key is the file name without directories and extension, of the form `<number>_<name>` without dots, and the number orders the history as an integer.
  A name that contains `/` is a path; another name is the key itself.
  `defineMigrations` rejects a key of another form and two keys of one number, such as `0002_create_user` and `2_create_tag`, or migrations of two branches that took one number.
- `defineMigrations` rejects a path of a file of [migration tests](#verification) with a hint to exclude migration tests from the patterns of `import.meta.glob`, rather than skipping it: a bundler builds a chunk of every module that the patterns match, with its imports, such as the test runner.
- A call loads only the modules of the migrations it applies or rolls back, so that migrating a target that is up to date loads none.
  It loads them all before running any, so that a module that fails to load changes nothing.
- The cache of loaded modules is that of the runtime, so histories with the same keys never share migrations.
- Migrations of a history rely on the search path and do not name the target schema, so that one history applies to any schema, such as the schema of each tenant.

## Targets

- A target is a database and a PostgreSQL schema: a `Db` of `kern-orm`, which gives both, or a `Database` of `kern-db`, so that a project without the ORM, such as one that queries the database with `kern-db` alone, runs its migrations.
  A target is typed by the members `$database` and `$schemaName` of a `Db`, so that checking a `Db` against it compares no queries.
- A target may be a `Driver` of `kern-db` instead, such as of a package that takes the driver of the application, which has no `Database` of its own to pass.
  A call creates a database over the driver and never closes it, since closing a database closes its driver, which belongs to the application; its statements run outside the transactions of any database of the application.
  The database belongs to the copy of `kern-db` of the migrator, so a migration of such a target that uses types or SQL fragments in its queries requires the application to share that copy: a database rejects those of another copy.
- `migrate`, `rollback`, `redo`, `getMigrationStatus`, and `verifyMigrations` check their target before their other arguments, and reject a value that is not a target, such as a client of PostgreSQL, with `TypeError`.
  The command line parses its arguments first and checks the target only for the commands that use the database.
- After the target, before any statement, `migrate`, `rollback`, `redo`, and `getMigrationStatus` reject with `TypeError` a `schemaName` that is not a non-empty string, so that a package that passes an option of its own as `schemaName` needs no check of it.
  `migrate`, `rollback`, and `redo` reject the same way a `count` that is not a positive integer, except `"all"` for `rollback`.
- `isMigrationTarget` recognizes a target using `isDatabase` and `isDriver` of `kern-db`, and a `Db` by a `$database` that `isDatabase` accepts and the presence of `$schemaName`, which it does not read.
- The `schemaName` option of a call overrides the PostgreSQL schema of the target, such as the schema of a tenant that is being created, which no context names yet.
- A call resolves the PostgreSQL schema once, at its start, calling the function of `schemaName` of a `Db` at most once; without one, the target is `current_schema()`, and a call rejects when it is `NULL`.

## Applying and rolling back

- Each target keeps the keys of its applied migrations, with the time of applying, in its table of versions in the target schema, `kern_migration` by default, with columns `key` and `applied_at`.
- Histories with different tables of versions apply to one target independently, such as the history of a package beside that of the application: a call reads and records only the table of its history, so the keys of another history, including those of the same numbers, are neither applied nor unknown to it.
  `verifyMigrations` checks a history in a schema of its own, without the objects of another history.
- Every call first resolves the target schema and checks that it and its table of versions exist, then reads the table only when it exists, since a statement on a missing table would fail and abort an enclosing transaction.
  It checks them with a query of `pg_catalog` rather than with `to_regclass` and `to_regnamespace`, whose lookups in the catalog cache of the connection miss a schema that another transaction committed while this one waited for the lock of the target.
  It rejects a target schema or a table of versions whose name is longer than `max_identifier_length` bytes before changing anything, since PostgreSQL truncates such a name, and the check would miss what the migrator created under it.
- `migrate` applies the pending migrations of a target, or the first `count` of them, and resolves to their keys.
- `migrate` returns after the first read when nothing is pending, so that migrating a tenant that is up to date at the first access of each process costs two statements outside a transaction.
  Otherwise, it locks the target with the [advisory lock](transactions.md#locks) of the qualified name of its table of versions, reads the versions again, and applies those still pending, so that processes that migrate a target at once apply each migration once.
- The lock belongs to the table of versions, so that different targets, such as tenants, and histories of one target migrate at once.
- In a transaction block, where `isInTransactionBlock` of the `Database` is `true`, such as inside a transaction that creates a tenant with its schema, a test transaction, or the seed of a test fixture, a call runs as a nested level that takes the lock with `lock`, and every migration runs `up` and `down` of its steps, so that its changes commit or roll back with the enclosing transaction.
- Outside one, a call runs in a [session](transactions.md#sessions), also without a migration that has changes outside a transaction, since it learns of them only from the migrations that it loads under the lock:
  - The session takes the lock with `pollLock`, since a transaction that waits for the lock with `lock` keeps a snapshot, which `CREATE INDEX CONCURRENTLY` of the session that holds the lock waits for ([decision](../decisions/migrations/polling-for-the-lock.md)).
  - Under the lock, it reads the versions again, chooses the migrations, loads them, and only then tells which run outside a transaction, since another process may change the applied migrations before the lock.
  - A migration with a change of its direction outside a transaction runs it alone, and the migrator records the migration after it in a statement of its own.
    The other migrations between such migrations run in one transaction of the session with their records, so that a call without such migrations runs in one transaction.
- A call inside a session outside its transactions rejects, since `session` rejects there; the migrator does not join that session, whose lock would last until the session ends, such as for the whole life of a worker.
- Outside a transaction block, the first read runs on the pool, and the read under the lock in the session outside its transactions, each statement in a transaction of its own with a new snapshot, so that both see what other processes have committed, whatever the default isolation level of the database.
- The transactions of a call in a session run at `READ COMMITTED`, whatever the default isolation level of the database, since creating the target schema and `createExtension` check again under a lock what another transaction has committed meanwhile, which the snapshot of a transaction at `REPEATABLE READ` or `SERIALIZABLE` misses.
- In a transaction block, the first read and the read under the lock come from the snapshots of the transaction, whose isolation level the call keeps:
  - At `REPEATABLE READ` or `SERIALIZABLE`, a call that has migrations to run rejects before it locks the target, since the read under the lock would come from the snapshot of the transaction, which misses the migrations that another process has applied or rolled back since ([decision](../decisions/migrations/strict-isolation-in-a-transaction.md)).
    It covers a test transaction and the seed of a test fixture, which run at the isolation level of their options, so on a database whose transactions default to a stricter level, a test that migrates requires `isolation: "read committed"` of its test transaction or fixture.
  - A call that finds nothing to run resolves to none at any isolation level, as the transaction sees the target.
  - The statement of the first read gives the isolation level of the transaction, so that the check costs no statement of its own.
- Under the lock, `migrate` creates the schema and the table of versions that the read found missing, with `IF NOT EXISTS`, so that no statement fails when something other than the migrator has created them meanwhile, which would abort an enclosing transaction.
  In a session, it creates them in the transaction of the first migrations, so that a call that fails there changes nothing, or before a first migration outside a transaction, in a transaction of their own.
  Creating only what is missing keeps PostgreSQL from sending a notice of an existing schema, which postgres.js logs by default.
- It creates the schema in a statement that takes a transaction-level advisory lock of the schema and checks the schema again under it, since histories of one target do not share the lock of the target, and `IF NOT EXISTS` misses a schema that another transaction has not committed yet and fails on the unique index of `pg_namespace` once that transaction commits.
  - The lock lasts until the transaction that creates the schema ends, so another history that creates the schema meanwhile waits for it, and its check under the lock sees the committed schema under `READ COMMITTED`, since each statement of the block takes a new snapshot.
  - The key of the lock includes the schema, so that calls that create different schemas, such as of new tenants, do not wait for each other.
- The search path of the level of the migrations, a nested level or a session, is the target schema followed by the schemas of the history, and the level restores the previous search path when it ends.
- After a call in a session fails, what committed before the failure stays, and the lock ends with the session.
  A change outside a transaction that failed may have run in part, and the record of its migration keeps the state before the change, unless the connection broke after the record committed:
  - a migration recorded as pending after its `up` failed needs `migrate`, which runs its `up` again;
  - a migration recorded as applied after its `down` failed needs `rollback`, which runs its `down` again, whereas `migrate` skips it.
- The migrator keeps no record of a call in progress, so running the same `rollback` or `redo` again does not continue it: their `count` chooses from the migrations applied then.
  `getMigrationStatus` reads the records of the migrations, not what a failed change has left in the schema, so the records tell which of the two calls a target needs.
- A call in a transaction block that waits for the lock of a target and a call in a session that runs `CREATE INDEX CONCURRENTLY` on that target can deadlock, since the index build waits for the end of every transaction with a snapshot older than its scan, such as the waiting one.
  PostgreSQL fails one of them with `40P01`: the call in the session recovers when called again, and the transaction when it runs again from its start, since the index build waits for it until it ends.
- A transaction that creates a target schema with one history and then migrates another history of that target can deadlock with a call of the other history in a session that waits for the lock of the schema, as with any two locks taken in different orders.
  PostgreSQL fails one of them with `40P01`: the call in the session recovers when called again, and the transaction when it runs again from its start, since it keeps the lock of the schema until it ends.
- A target is up to date when its applied keys are the keys of the history, followed by keys after the last key of the history, if any, which a newer version of the application has applied, such as during a rolling deploy.
  `migrate` rejects an applied key that the history lacks before its last key or that is not of the form of a key, and a pending migration before an applied one.
- `rollback` undoes the last applied migrations of a target, one by default, a given number of them, or all, and `redo` undoes and applies them again, each locking the target and running the migrations as `migrate` does; `count` counts migrations with and without changes outside a transaction alike.
  They resolve to the keys in the order they undo and apply them, and to none without a transaction when the target has no table of versions.
  They reject when the target has applied keys that the history lacks, since they cannot run the `down` of a migration they do not have.
- `getMigrationStatus` gives the PostgreSQL schema that it resolved, the applied and the pending keys of the target, and its applied keys that the history lacks, as `unknown`.
- An error of a migration is a `MigrationError` that names its key, and its step and direction for an error of a step, and keeps the original error in `cause`.
  Its message includes the message of the original error, since not every log shows `cause`.

## Helpers

- Helpers (`src/helpers/`) build steps of typical changes, such as `createTable` and `changeColumn`, as plain steps of SQL text, so that they combine in the array of a migration with steps of its own.
  A step with changes outside a transaction, such as of `createIndex` with `concurrently`, has functions there and must be the only step of its migration.
- A project writes its own helpers with the public primitives that the built-in helpers use:
  - `quoteIdentifier` and `quoteLiteral`; `quoteLiteral` matches `quote_literal` of PostgreSQL, doubling quotes and backslashes and prefixing `E` to a value with a backslash, so that a literal keeps its value whatever `standard_conforming_strings` is;
  - `invertStep`, which swaps `up` and `down`, also of the changes outside a transaction, and rejects a step without `down`;
  - `combineSteps`, which makes one step that runs the `up` of the steps in order and the `down` of those that have one in reverse order.
    Changes of a direction that are all SQL text join into one script with each semicolon on a line of its own, so that a script that ends with a line comment does not comment it out; other changes run in order from a function.
    It rejects a step with changes outside a transaction, which must be the only step of its migration.
  - `invertStep` and `combineSteps` reject a value that is not a step, as loading a migration does, since the step they return would hide a problem such as a misspelled `down`.
- The SQL that a helper builds never changes: applied migrations call the same helper on new targets, and a change of its SQL would change what they do there.
  A new behavior requires a new helper or option; the helpers of a project must follow the same rule.
- Helpers quote the names they take as arguments or keys and never qualify them with a schema, which the search path of the migration gives.
  They quote with `quoteIdentifier`, since a step is SQL text, which a fragment of `identifier` from `kern-db` is not.
  They insert SQL text, such as definitions, conditions, defaults, and the elements of an index, as it is.
- They add no `IF EXISTS`, `IF NOT EXISTS`, or `CASCADE`, except `createExtension`, so that a `down` that does not match its `up` fails instead of passing or dropping dependent objects.
  The changes outside a transaction of `concurrently` check the catalog instead, since they must be safe to run again, so the `up` and `down` that a transaction runs catch such a mismatch.
- A helper checks its arguments when it is called, such as when the module of its migration loads, so that a mistake it finds fails the migration before anything runs; PostgreSQL checks the SQL text that it takes when the step runs.
  `quoteIdentifier` rejects an empty name, so that a name left blank fails before the migration runs.
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
- `createIndex` and `dropIndex` with `concurrently` keep `up` and `down`, and add [changes outside a transaction](#changes-outside-a-transaction) of `CREATE INDEX CONCURRENTLY` and `DROP INDEX CONCURRENTLY`, each a statement of its own.
  - They find the index and the table by their names with `to_regclass`, through the search path as `DROP INDEX` and `CREATE INDEX` find them, and check in `pg_index` that the index belongs to the table, so that dropping drops the index that the check found.
    `to_regclass` truncates a name to 63 bytes, as PostgreSQL truncates the name of an index.
  - They check the catalog rather than add `IF [NOT] EXISTS`, which sends a notice of what exists, and keeps an index that a failed build has left not valid.
  - They reject a name that finds another relation, such as an index of another table, also in an earlier schema of the search path, where it hides the index of the table, before they change anything: building would create an index that dropping cannot find, and dropping would leave the index while its migration is recorded as rolled back.
  - Building does nothing when the table has a valid index of the name, which an attempt whose record of the migration failed has built ([decision](../decisions/migrations/valid-index-counts-as-built.md)), and drops an index of the name that is not valid before building it.
  - Dropping does nothing when the name finds nothing.
  - They check the catalog with one statement of `execute`, which returns the state of the index as text, so that they decode it without the types of `kern-db/types`.
  - A partitioned table requires a step of its own: PostgreSQL rejects `CREATE INDEX CONCURRENTLY` of a partitioned table and `DROP INDEX CONCURRENTLY` of its index before they change anything ([decision](../decisions/migrations/concurrent-index-of-partitioned-table.md)).
- `createSequence` and `changeSequence` take each number of their options as a safe integer of `number` or as any integer of `bigint`, and reject another `number`, which may differ from the integer that the code wrote.
- `changeSequence` takes the states of a sequence before and after the change, which list the same options, as `changeColumn` does, with `null` of `minValue` and `maxValue` for the defaults of the type.
  It builds one `ALTER SEQUENCE` of the options that differ, comparing numbers by value, so that `10` and `10n` are the same.
  A change of `type` or of the sign of `increment` requires `minValue` and `maxValue` in both states and sets them also when they do not differ, since PostgreSQL derives the defaults from the type and the direction, and replaces a bound equal to a limit of the old type with that of the new type, which rollback would not restore.
  A change of `type` requires the bounds as numbers: when `AS` changes the type, `NO MINVALUE` and `NO MAXVALUE` can give the limits of the new type whatever the direction.
  It does not restart the sequence: `start` changes only the value that a restart begins from, since the value before a restart is not part of a state that rollback could restore.
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
- It does not close the database or the driver of the target: the script that created them owns them.
  It never rejects: it prints an error to stderr and sets `process.exitCode` to 1, so that the script closes them after it.
  - A usage error prints its message with a hint to `--help`; arguments without a command print the usage to stderr.
  - An error of a command prints whole with `console.error`, with its stack, `cause`, and the fields of a PostgreSQL error, such as `detail`.
- `--schema` sets the PostgreSQL schema of the target.
  Otherwise, the command line reads `$schemaName` of a `Db` once, before the command, and passes the call the `Database` of the target with that `schemaName`, so that the call does not read it again.
  When the function of the schema throws, such as of the current tenant, which a command line has no context for, the error names `--schema`.
- `new <name>` creates the module of the next migration in `directory`, and never overwrites a file.
  - `<name>` has only letters, digits, `_`, and `-`, so that it makes a key, a file name on every file system, and an import specifier.
  - Its number follows the greatest number of the keys of the history and of the migration modules of the directory, with as many digits as the key of that number.
  - The migration modules of a directory are its files of `.ts`, `.mts`, `.js`, or `.mjs` whose name without the extension is a key, so that `index.ts` and migration tests `<key>.migration-test.ts` are not; two modules of one number are an error.
  - The default template is `createTable` for the first migration of the history and the directory, and `addColumn` for a later one, the most common changes; their names are blank, which fail to load until they are filled in, so that a migration left as created never applies.
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

- `verifyMigrations(target, history, options)` (`src/verification/`) checks a history in a temporary schema of the database of its target, whose schema it ignores, in a transaction that always rolls back, nested in the enclosing transaction of a `Database` or a `Db`, such as a test transaction; on a `Driver`, it runs in a transaction of its own.
  - The temporary schema is `kern_verify_` with 12 random hexadecimal digits, so that verifications in parallel test processes do not wait for each other on the unique index of `pg_namespace`.
  - Its search path is the temporary schema followed by the schemas of the history, as `migrate` gives a target.
  - In the transaction, every step runs its `up` and `down`, so the [changes outside a transaction](#changes-outside-a-transaction) go unchecked.
  - It runs at the isolation level of the enclosing transaction, or at the default of the database in a transaction of its own, since no other process changes its temporary schema.
    At `REPEATABLE READ` or `SERIALIZABLE`, `createExtension` of a migration fails when another transaction creates the extension and commits while the verification waits for the lock of extensions.
- Before any statement, it rejects a history without migrations, which more likely comes from a pattern that matches no file than from a project without migrations, loads the migration tests, rejecting a file of tests that matches no migration, and loads every migration.
- It verifies the migrations in the order of the history, each on the schema that the migrations before it leave:
  1. It applies the migration and describes the structure of the schema.
  2. In a nested level that rolls back, it rolls the migration back and requires the structure that the migration found; runs each migration test of the migration in a nested level of its own that rolls back; and applies the migration again.
  - The structure after the second `up` goes unchecked: from the structure that the first `up` found, `up` builds the same one unless it depends on something else, such as data, so the verification describes the schema twice for each migration rather than three times.
  - Applying, rolling back, and applying again misses a `down` that leaves a change that `up` makes again without an error, such as `SET NOT NULL`, `SET DEFAULT`, or `CREATE INDEX IF NOT EXISTS`; comparing the structure catches it.
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
  - Its callbacks take the database of the migration, so that their SQL names tables without a schema.
  - `defineMigrationTest`, and loading a file of tests, reject an unknown property, such as a misspelled `assertDown`, which would never run, `assertUpError` together with `assertUp` or `assertDown`, and a test without callbacks.
  - An error of a test names the test, its file, and the stage that failed, such as `assertUp`, and keeps the original error in `cause`.
- The migration tests of a migration are the default exports, a test or a non-empty array of tests, of the files `<key>.migration-test.<extension>` and `<key>.<name>.migration-test.<extension>` beside it, with the extensions of migration modules.
  - `tests` of `verifyMigrations` is their directory, whose other files it skips, or their modules or loaders by path, as `import.meta.glob` returns them, whose paths must name files of migration tests.
  - The tests of a migration run in the order of the names of their files, and of the tests in a file.
  - It imports the files of a directory by their `file:` URLs with the loader of the runtime, such as of Node.js or Bun; under Vitest, the loaders of `import.meta.glob` let Vite transform the files as it transforms test files, such as with the aliases of its configuration.
  - The suffix `.migration-test` keeps the default patterns of `bun test` and Vitest from running such a file as a test file; `node --test` without patterns runs it as a file without tests.
