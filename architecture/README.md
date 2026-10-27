# Architecture

kern-orm is a fully typed relational query builder for PostgreSQL rather than a traditional ORM.
It has no managed entities, identity map, dirty tracking, or unit of work.

Its core promises:

- Queries infer results, parameters, nullability, and nested selections.
- Nested relations load in a constant number of round trips through subqueries that aggregate their rows as JSON.
- Queries join the ambient transaction of the current async context without passing a transaction around.

The public API is not settled before 1.0 and may change in any release.

## Motivation

kern-orm exists to solve problems of production projects on Orchid ORM:

- Test isolation ([orchid-orm#798](https://github.com/romeerez/orchid-orm/issues/798)): code that outlives a timed-out test or hook keeps querying, and its queries must not run in the transaction of another test or on the pool.
  A test transaction level belongs to the callback of one test run, and a failure to start one rejects instead of hanging.
- Transaction routing ([orchid-orm#803](https://github.com/romeerez/orchid-orm/issues/803), [#808](https://github.com/romeerez/orchid-orm/issues/808)): every statement of a transaction, including its own settings, runs on its connection, whatever options wrap the call.
- After-commit hooks ([orchid-orm#817](https://github.com/romeerez/orchid-orm/issues/817), [#825](https://github.com/romeerez/orchid-orm/issues/825)): hooks run for the work that was committed, never for work rolled back to a savepoint, whichever instance of the database registered them.
- Reusable column types ([orchid-orm#405](https://github.com/romeerez/orchid-orm/issues/405)): a type is a standalone value that unrelated projects share, extend, and compose without a base table or a validation library.
- Shared tables across schemas ([orchid-orm#696](https://github.com/romeerez/orchid-orm/issues/696)): tenant and SaaS schemas share table definitions with their own relations, and typed business logic shared between them uses only what both have.
- Dynamic PostgreSQL schemas ([orchid-orm#762](https://github.com/romeerez/orchid-orm/issues/762)): a PostgreSQL schema resolved at runtime, such as the schema of the current tenant from the async context, is read only when a query is compiled, never when a database is created or a schema is bound.
- Singleton tables ([orchid-orm#752](https://github.com/romeerez/orchid-orm/issues/752)): a table that holds at most one row, such as application settings, is read and upserted without a sentinel key passed to every query or an `all()` that needs a comment at every use.
- Migration verification ([rake-db-testing](https://github.com/IlyaSemenov/rake-db-testing)): every migration applies, rolls back, and applies again, and data scenarios check how it transforms existing rows; kern-orm will include it.

## Map

Module paths are relative to `packages/kern-orm/src/`.

- [Types and expressions](types.md): `type/` and `expression/`.
- [Tables, schemas, and Db](schemas.md): `table/`, `schema/`, and `execution/db.ts`.
- [Queries](queries.md): `query/` and `execution/db.ts`.
- [SQL generation](sql.md): `ast/`, `lowering/`, `compiler/`, and `result/`.
- [Transactions](transactions.md): `execution/database.ts` and `execution/transaction.ts`.
- [Testing](testing.md): `execution/testing.ts` and `execution/transaction.ts`.
- [Drivers](drivers.md): `execution/driver.ts` and `packages/postgres-js/`.

## Decisions

These hold for features that are not implemented yet.

- Mutations require an effective restriction or an explicit `all()`; a predicate simplified to `TRUE` is not a restriction ([orchid-orm#847](https://github.com/romeerez/orchid-orm/issues/847), [#854](https://github.com/romeerez/orchid-orm/issues/854)).
- An update that deletes the record its selected records reference changes only the selected records; other records that reference it only lose the reference ([orchid-orm#853](https://github.com/romeerez/orchid-orm/issues/853)).
- Migrations are fixed artifacts that never import runtime tables or types.
