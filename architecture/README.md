# Architecture

kern-orm is a fully typed relational query builder for PostgreSQL rather than a traditional ORM.
It has no managed entities, identity map, dirty tracking, or unit of work.

Its core promises:

- Queries infer results, parameters, nullability, and nested selections.
- Nested relations load in a constant number of round trips through subqueries that aggregate their rows as JSON.
- Queries join the ambient transaction of the current async context without passing a transaction around.

The public API is not settled before 1.0 and may change in any release; a change of what companion packages rely on follows [package compatibility](compatibility.md).

[Decisions](../decisions/README.md) record the trade-offs between designs, with their alternatives and costs, and the contracts here link them.

## Motivation

kern-orm exists to solve problems of production projects on Orchid ORM:

- Test isolation ([orchid-orm#798](https://github.com/romeerez/orchid-orm/issues/798)): code that outlives a timed-out test or hook keeps querying, and its queries must not run in the transaction of another test or on the pool.
  A test transaction level belongs to the callback of one test run, and a failure to start one rejects instead of hanging.
- Transaction routing ([orchid-orm#803](https://github.com/romeerez/orchid-orm/issues/803), [#808](https://github.com/romeerez/orchid-orm/issues/808)): every statement of a transaction, including its own settings, runs on its connection, whatever options wrap the call.
- After-commit hooks ([orchid-orm#817](https://github.com/romeerez/orchid-orm/issues/817), [#825](https://github.com/romeerez/orchid-orm/issues/825)): hooks run for the work that was committed, never for work rolled back to a savepoint, whichever instance of the database registered them.
- Reusable column types ([orchid-orm#405](https://github.com/romeerez/orchid-orm/issues/405)): a type is a standalone value that unrelated projects share, extend, and compose without a base table or a validation library.
- Column naming conventions ([orchid-orm#197](https://github.com/romeerez/orchid-orm/issues/197)): the conversion of column keys to physical names is a function that an application chooses, rather than a fixed option that gives `user_i_d` for `userID`.
- Shared tables across schemas ([orchid-orm#696](https://github.com/romeerez/orchid-orm/issues/696)): tenant and SaaS schemas share table definitions with their own relations, and typed business logic shared between them uses only what both have.
- Dynamic PostgreSQL schemas ([orchid-orm#762](https://github.com/romeerez/orchid-orm/issues/762)): a PostgreSQL schema resolved at runtime, such as the schema of the current tenant from the async context, is read only when a query is compiled or `$schemaName` of its `Db` is read, never when a database is created or a schema is bound.
- Singleton tables ([orchid-orm#752](https://github.com/romeerez/orchid-orm/issues/752)): a table that holds at most one row, such as application settings, is read and upserted without a sentinel key passed to every query or an `all()` that needs a comment at every use.
- Migration verification ([rake-db-testing](https://github.com/IlyaSemenov/rake-db-testing)): every migration applies, rolls back to the structure before it, and applies again, and migration tests check how it transforms existing rows; [`kern-migrations/testing`](migrations.md#verification) includes it.

## Layers

Module paths are relative to the `src/` directory of their package: `packages/db/src/` for `kern-db`, and `packages/orm/src/` for `kern-orm`.

- The database layer, the package `kern-db` (`packages/db/`), runs statements on the connections of a driver.
  It holds the `Database` of transactions, sessions, and advisory locks, the driver contract, its errors, and the drivers, the test helpers, the contract of types, the built-in types, its SQL fragments with their renderer, its queries of SQL text, the rows modes of results with the errors of a result that breaks its contract and the decoding of flat results, and the text representations of the values that it reads and writes itself, such as of arrays and Booleans.
  It imports no other package of the repository, also for types; only its tests and the test helpers of its modules import the [test harness](testing.md).
  The other workspaces import it only through its entry points; `packages/db/tests/boundaries.test.ts` checks both ([decision](../decisions/packages/database-package.md)).
  `kern-db` exports its `Database`, the driver contract and its errors, the contract of types, its SQL fragments, the types of its queries of SQL text, and the errors of their results; `kern-db/types` exports the built-in types, and importing it loads only the modules of types, without the transaction coordinator; `kern-db/postgres-js` and `kern-db/node-postgres` export the drivers; `kern-db/testing` exports the test helpers and the driver contract; `kern-db/builder` exports what a query builder on top of it compiles and decodes with, as [SQL generation](sql.md) describes.
- The ORM, the package `kern-orm` (`packages/orm/`), builds on it through its entry points, as any query builder can.
  It has no `Database` of its own: the root of `kern-orm` exports `createDatabase` of the layer, `bindSchema` of `execution/db.ts` binds a schema to a `Database` of the layer, and `$query` of a `Db` starts a query of SQL text of the layer whose statement the `Db` compiles.
  `kern-orm/db`, `kern-orm/db/types`, `kern-orm/db/postgres-js`, `kern-orm/db/node-postgres`, and `kern-orm/testing` re-export the entry points of `kern-db`, so that an application of the ORM does not require `kern-db` itself.
  Its build imports `kern-db` rather than bundling it, so that the values of the layer, such as types, are those of the one `kern-db` of the application.
- The migrator, the package `kern-migrations` (`packages/migrations/`), uses only types of `kern-db` and nothing of `kern-orm`, and takes a `Db` by its members, as [migrations](migrations.md) describe.

## Map

- [Types and expressions](types.md): `type/` and `expression/` of `kern-orm`, and `type/`, `sql/`, `index.ts`, and `types.ts` of `kern-db`.
- [Tables, schemas, and Db](schemas.md): `table/`, `schema/`, and `execution/db.ts`.
- [Queries](queries.md): `query/` and `execution/db.ts`.
- [Mutations](mutations.md): `query/mutation.ts` and `query/values.ts`.
- [Queries of SQL text](sql-queries.md): `sql/query.ts`, and `query` and `script` of `database.ts` of `kern-db`, and `$query` and the scripts of `execution/db.ts`.
- [SQL generation](sql.md): `ast/`, `lowering/`, `compiler/`, and `result/` of `kern-orm`, and `result.ts`, `identifier.ts`, and `builder.ts` of `kern-db`.
- [Transactions](transactions.md): `database.ts` and `transaction/` of `kern-db`.
- [Testing](testing.md): `test-helpers.ts` and `transaction/fixture-stack.ts` of `kern-db`, the test harness in `testing/` of the repository, and the package test in `packages/orm/tests/package/`.
- [Drivers](drivers.md): `driver.ts`, `driver-error.ts`, `error-condition.ts`, `error-condition-codes.ts`, `driver-contract.ts`, and `drivers/` of `kern-db`.
- [Migrations](migrations.md): `packages/migrations/`.
- [Package compatibility](compatibility.md): the ranges by which the packages of the repository depend on each other.
