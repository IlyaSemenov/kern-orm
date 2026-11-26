# Moving from rake-db

A project moves its migrations from rake-db to `kern-migrations` with a first migration that builds what its migrations of rake-db built: a new target runs it, and a target that rake-db built is already in its state, so the project records its key without running it.
The migrations of rake-db are neither converted nor run, and the rows of its table of versions are not imported.

Preliminary decisions:

- A call, such as `recordMigrations(target, history, { through, verify })`, records the keys of a history up to `through` as applied without running their migrations, since the [table of versions is the state of a target](../architecture/migrations.md#applying-and-rolling-back), and no row of it tells `migrate` that another migrator built the schema.
  - Under the lock of the target and in one transaction, it calls `verify` with the database of the migration, creates the table of versions, and records the keys, so that a `verify` that rejects changes nothing.
  - On a target that has `through`, also one with later migrations, it does nothing and does not call `verify`, so that an application may call it before every `migrate`.
  - It rejects a target that has rows and lacks `through`, which `migrate` takes there.
  - It changes neither the table of versions of rake-db nor the data of the target, and no later call reads that table.
- The migrator knows nothing of rake-db: `verify` is a check of the project, and the call serves a schema that any other migrator built.
- `@kern-orm/orchid-interop` gives the check of rake-db as a function that returns a `verify`.
  - It takes the schema and the name of the table of versions of rake-db, which a project may configure, and the complete list of the versions that the first migration stands for.
  - It reads the rows of the table and rejects a repeated, a missing, and an unlisted version; the greatest version or the number of rows does not tell that the list is complete.
  - It runs its statements on the database that `verify` receives, and requires neither rake-db nor the tables of the application.
  - It must need nothing of the call beyond `verify`; otherwise the check stays a recipe of the documentation.

Open questions:

- Decide the names of the call and of its options.
- Decide whether the check compares the names of the rows of rake-db.
  Check in the supported version of rake-db how a name differs between a source and a compiled file, in a bundle, and for a migration of `pull`.
- Decide whether a history may declare the check instead, so that `migrate` records the keys itself.
  A call of its own makes the cutover a deliberate step of a release, while a tenant that migrates at its first request then needs the call before every `migrate`.
- On a target that awaits the call, `migrate` runs the first migration, whose first `CREATE TABLE` fails, and the transaction rolls back, unless the migration has `IF NOT EXISTS`, which the guide must warn of.
  Decide whether the error of a first migration that fails on a target without rows names the call.
- Test the check and the call against a real rake-db of the supported version: a complete table, a gap below the greatest version, repeated and unlisted versions, a configured schema and table, rows of the application that stay, a `verify` that rejects, two calls at once, and later migrations.
  Record the supported version and what was learned of rake-db in [comparison](../comparison/migrations.md).

## Guide

A page of the documentation on the cutover in two releases:

- The last release with rake-db applies every migration of rake-db to every target, such as [every tenant](migrating-every-tenant.md), with its [recurrent migrations](recurrent-sql-of-migrations.md), freezes the list of its versions, and stops everything that runs rake-db.
  Check in the supported version whether `migrate` of rake-db called from code runs the recurrent migrations as its command line does.
- The first release with `kern-migrations` records the first migration before `migrate` on every existing target, and `migrate` alone runs it on a new one.
- The advisory lock of rake-db can keep a running rake-db out of the check, but does not replace stopping it.
