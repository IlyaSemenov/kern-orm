# Writing and checking a baseline

Writing the [baseline](squashing-a-history.md) of a history, and checking that it builds what the migrations it replaces build: a target that the baseline built is never compared with one that the replaced migrations built, so a difference between them stays unnoticed until a later migration fails on one of them.

## Writing

- Preliminary decision: a command of the command line, such as `squash`, creates the module of the baseline with blank steps that fail to load until they are filled in, as `new` creates a migration, and gives the keys of `replaces`, the keys of the history.
  It changes no target and removes no module.
- Decide whether the command writes the keys into a module that the project passes as `replaces`, as `new` writes the list module, or prints them for the options of `defineMigrations`.
- Decide what the command does for a history that has a baseline, whose module it must not overwrite.
- Decide whether anything writes the SQL of the baseline from a schema that the replaced migrations built.
  The migrator leaves generating migrations to the application ([decision](../decisions/migrations/migrator-scope.md)), and `pg_dump --schema-only` names the schema of every object, while migrations rely on the search path.

## Checking

- Preliminary decision: `verifyMigrations` of a history that keeps the modules of all keys of `replaces` compares the baseline with them, with no call of its own and no database of its own.
  - Decide how it tells a `replaces` that starts at the first migration of the history, whose modules build from an empty schema, from a shortened one, such as by an option that asks for the comparison.
  - It describes the structure that the replaced migrations leave and the structure that the baseline builds, and requires them to be the same.
  - Both run in the temporary schema, the baseline after a nested level of the replaced migrations rolls back, since two descriptions compare only under one search path.
  - It verifies the migrations after the last replaced key once, on the schema of the baseline.
- Decide whether it also rolls back the last replaced migration on the schema of the baseline, which `rollback` does on a target that the baseline built while the history keeps the modules.
- The comparison tells the order of the columns of a table and of the attributes of a composite type, which `INSERT` without a list of columns and `SELECT *` depend on, while the comparison after a rollback keeps leaving it out.
- Decide whether it compares the extensions that each path creates, whose objects the structure leaves out.
- The structure describes no rows, such as the reference data that a replaced migration inserts, and no state of a sequence.
  Decide how a project checks them, such as by a migration test of the baseline whose assertion runs after the replaced migrations and after the baseline, so that one assertion checks both, and how the file of such a test is named, since a baseline has no key.
- A release that squashes a history changes nothing on an existing target, so its data needs no check of its own: the migration tests of the later migrations cover it.
- Once the project removes modules of the replaced migrations, nothing compares the baseline.
  Decide whether the verification takes them apart from the history, such as from an archive that the patterns of the history exclude; otherwise a project keeps them in the history for as long as it wants the check.
- After squashing again, the history keeps at most the migrations between the two states, which have no schema to start from.
  Decide whether the verification takes the previous baseline to start them from, and compares what they build with the new baseline.
- The documentation must list what the comparison covers rather than claim that the databases are equal.
  It does not cover the [changes outside a transaction](changes-outside-a-transaction-in-verification.md) of the replaced migrations, whose `up` it runs instead, or objects outside the schema, such as roles.
  Comparing two databases that the project gives would cover them, at the cost of a setup that `verifyMigrations` does not need.

## Documentation

A page on squashing with an example from end to end: a history with a migration that fills a column and one that inserts reference data, a baseline that keeps their outcome, a target with rows that the release leaves as it is, a new target that the baseline builds, and a later migration that applies to both.
