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
- Migration verification ([rake-db-testing](https://github.com/IlyaSemenov/rake-db-testing)): every migration applies, rolls back to the structure before it, and applies again, and migration tests check how it transforms existing rows; [`@kern-orm/migrations/testing`](migrations.md#verification) includes it.

## Layers

Module paths are relative to `packages/kern-orm/src/`.

- The database layer (`database/`) runs statements on the connections of a driver.
  It holds the `Database` of transactions, sessions, and advisory locks, the driver contract and its errors, the test helpers, the contract of codecs, the codecs of the built-in types, its SQL fragments with their renderer, the rows modes of results with the errors of a result that breaks its contract, and the text representations of the values that it reads and writes itself, such as of arrays and Booleans.
  Its production modules import only each other and Node.js built-ins, also for types, so that it works without the ORM ([backlog](../backlog/database-layer-as-a-package.md)).
  `kern-orm/db` exports its contract of codecs and its SQL fragments, and `kern-orm/db/types` the codecs of the built-in types, and importing `kern-orm/db/types` loads only the modules of codecs of the layer, without the ORM and the transaction coordinator.
- The ORM, the other modules, builds on it.
  `execution/database.ts` adds `bind` and `query` to its `Database`; `query` runs on a `Db` of no tables.

## Map

- [Types and expressions](types.md): `type/`, `expression/`, `database/codec/`, `database/codecs/`, `database/sql/`, `db.ts`, and `db/types.ts`.
- [Tables, schemas, and Db](schemas.md): `table/`, `schema/`, `execution/db.ts`, and `bind` of `execution/database.ts`.
- [Queries](queries.md): `query/` and `execution/db.ts`.
- [Mutations](mutations.md): `query/mutation.ts` and `query/values.ts`.
- [Queries of SQL text](sql-queries.md): `query/sql-query.ts`, the scripts of `execution/db.ts`, `query` of `execution/database.ts`, and `script` of `database/database.ts`.
- [SQL generation](sql.md): `ast/`, `lowering/`, `compiler/`, `result/`, `database/result.ts`, and `database/identifier.ts`.
- [Transactions](transactions.md): `database/database.ts` and `database/transaction/`.
- [Testing](testing.md): `database/testing.ts` and `database/transaction/fixture-stack.ts`.
- [Drivers](drivers.md): `database/driver.ts`, `database/driver-error.ts`, `database/error-condition.ts`, `database/error-condition-codes.ts`, `execution/driver-contract.ts`, `packages/postgres-js/` and `packages/node-postgres/`.
- [Migrations](migrations.md): `packages/migrations/`.
- [Package compatibility](compatibility.md): the peer dependency of companion packages on `kern-orm`, and `packages/kern-orm/tests/package/compatibility.package-test.ts`.
