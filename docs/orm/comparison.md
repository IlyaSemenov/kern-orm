# Comparison

This page helps you choose between kern-orm and other TypeScript ORMs and query builders for PostgreSQL: [Drizzle ORM](https://orm.drizzle.team/), [Kysely](https://kysely.dev/), [Prisma ORM](https://www.prisma.io/orm), and [Orchid ORM](https://orchid-orm.netlify.app/).
It compares Drizzle ORM 0.45.4, Kysely 0.29.8, Prisma ORM 7.10.1, Orchid ORM 1.78.47, and kern-orm 0.17, as of November 2026, by their documentation and sources, which each row links.

## When kern-orm fits

Choose kern-orm when your application on PostgreSQL needs:

- Records with their related records, typed and loaded in one SQL statement.
- Transactions that the functions it calls join without a transaction object passed to them.
- A PostgreSQL schema per tenant, served by one `db` with the same table definitions and queries.
- Tests that each run in a transaction that rolls back, including the transactions of the tested code.

Consider another library when you need what kern-orm does not have:

- Databases other than PostgreSQL.
- Migrations generated from your table definitions: with kern-migrations, you write each migration with helpers, SQL, or TypeScript.
- Joins, and relations through other relations or through a join table.
- A stable API: kern-orm is in early development, and its API changes between minor versions.

## At a glance

|                                                                                                     | kern-orm                                | Drizzle ORM                                       | Kysely                                                                   | Prisma ORM                                                   | Orchid ORM                          |
| --------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------ | ----------------------------------- |
| [Related records in one statement](#related-records-in-one-statement)                               | Built in                                | Built in                                          | Requires a subquery per relation                                         | Behind a preview feature                                     | Built in                            |
| [Transactions without passing them around](#transactions-without-passing-them-around)               | Built in, from kern-db                  | Not supported                                     | Not supported                                                            | Not supported                                                | Built in                            |
| [One `db` for a schema per tenant](#a-schema-per-tenant)                                            | Built in                                | Not supported                                     | An instance per schema                                                   | A client per schema                                          | Built in                            |
| [Tests in transactions that roll back](#tests-in-transactions-that-roll-back)                       | Built in, from kern-db                  | Requires passing a transaction to the tested code | Requires passing a transaction to the tested code, which cannot nest one | Through jest-prisma                                          | Built in                            |
| [Rows of SQL text](#rows-of-sql-text)                                                               | Decoded by declared types, from kern-db | Typed by an unchecked type argument               | Typed by an unchecked type argument                                      | Typed by an unchecked type argument, or generated in preview | Typed by an unchecked type argument |
| [Migrations](#migrations)                                                                           | Written, with kern-migrations           | Generated                                         | Written                                                                  | Generated                                                    | Written or generated                |
| [Checking table definitions against the database](#checking-table-definitions-against-the-database) | A check of compatibility                | Not supported                                     | A check of generated types, through kysely-codegen                       | A schema diff                                                | Not found                           |

kern-orm takes transactions, test transactions, and queries of SQL text from kern-db, which it installs, and migrations from kern-migrations, which you install beside it; see [Kern Libraries](../ecosystem).

## Related records in one statement

With kern-orm, select the related records of each row in the callback of `select`, at any depth: the query loads them in one SQL statement, with the shape of the result inferred; see [Related Records](./queries/relations).

- Drizzle ORM: its relational queries, `db.query`, load relations in one statement of `LEFT JOIN LATERAL` subqueries ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/dialect.ts#L1313-L1372)).
- Kysely: it has no relations; nest a correlated subquery of each relation in `jsonArrayFrom` or `jsonObjectFrom` ([docs](https://github.com/kysely-org/kysely/blob/v0.29.8/site/docs/recipes/0001-relations.md)).
- Prisma ORM: `include` loads relations in one statement only with the preview feature `relationJoins`, and in a query per table otherwise ([docs](https://www.prisma.io/docs/orm/v7/prisma-client/queries/relation-queries#relation-load-strategies-preview)).
- Orchid ORM: relations selected in `select` load in one statement of `LEFT JOIN LATERAL` subqueries ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/join.md#L37)).

## Transactions without passing them around

With kern-orm, the queries in the callback of `db.$transaction`, including those of the functions it calls, run in the transaction; see [Transactions](./transactions).

- Drizzle ORM: only the queries of the `tx` that `transaction` passes to its callback run in the transaction ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/db.ts#L636-L641)).
- Kysely: only the queries of the transaction object run in the transaction ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/kysely.ts#L241-L260)).
- Prisma ORM: only the queries of the `tx` that `$transaction` passes to its callback run in the transaction ([docs](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions#interactive-transactions)).
- Orchid ORM: the queries of `db` in the callback of `$transaction` run in the transaction ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/transactions.md#transaction)).

## A schema per tenant

With kern-orm, pass `bindSchema` a function that returns the PostgreSQL schema of the current request, and one `db` serves every tenant; tables of a shared schema stay in it; see [PostgreSQL schemas](./schemas#postgresql-schemas) and [Multiple Schemas](./multiple-schemas).

- Drizzle ORM: a table belongs to the schema of its definition, with no override at runtime ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/schema.ts#L9-L24)).
- Kysely: `withSchema` gives an instance that queries the tables in a schema, and the shared tables are qualified in the types of the database ([docs](https://github.com/kysely-org/kysely/blob/v0.29.8/site/docs/recipes/0007-schemas.md)).
- Prisma ORM: a model with `@@schema` belongs to that schema ([docs](https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/multi-schema)), and a model without it to the default schema of the client, which the `schema` option of `PrismaPg` sets, so a schema per tenant requires a client per schema ([source](https://github.com/prisma/prisma/blob/7.10.1/packages/adapter-pg/src/pg.ts#L171-L173)).
- Orchid ORM: the `schema` option of `orchidORM` takes a function, called for every query ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/orm-setup.md#global-db-schema)).

## Tests in transactions that roll back

With kern-orm, run each test in a transaction that rolls back, with `node:test`, `bun:test`, or Vitest; the tested code queries the `db` of your application, and its transactions run as nested transactions; see [Testing](./testing).

- Drizzle ORM: it has no test helper; the tested code joins a transaction of a test only through a `tx` passed to it, and its transactions in it are savepoints ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/node-postgres/session.ts#L283-L300)).
- Kysely: it has no test helper; the tested code joins a transaction of a test only through a transaction object passed to it, and cannot start a transaction in it ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/kysely.ts#L675-L690)).
- Prisma ORM: its guide of integration tests deletes the data after the tests ([docs](https://www.prisma.io/docs/orm/v7/prisma-client/testing/integration-testing)); [jest-prisma](https://github.com/Quramy/jest-prisma/blob/v1.8.2/README.md#transaction-rollback), a library of its own, runs each Jest test in a transaction that rolls back.
- Orchid ORM: `testTransaction` runs each test in a transaction that rolls back, and the transactions of the tested code in it as savepoints ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/transactions.md#testtransaction)).

## Rows of SQL text

With kern-orm, pass the types of the fields to a query of SQL text: it decodes each field from its column, and rejects a result without the column; see [SQL Statements](./queries/sql).

- Drizzle ORM, Kysely, and Orchid ORM: `execute`, `sql`, and `$query` type the rows by a type argument that nothing checks ([Drizzle ORM](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/db.ts#L615-L634), [Kysely](https://github.com/kysely-org/kysely/blob/v0.29.8/src/raw-builder/sql.ts#L79), [Orchid ORM](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/orm-methods.md#query)).
- Prisma ORM: `$queryRaw` types the rows by a type argument that nothing checks ([docs](https://www.prisma.io/docs/orm/v7/prisma-client/using-raw-sql/raw-queries#typing-queryraw-results)), and its preview feature TypedSQL generates the types of the rows of a SQL file from the database ([docs](https://www.prisma.io/docs/orm/v7/prisma-client/using-raw-sql/typedsql)).

## Migrations

With kern-migrations, write each migration with schema helpers, SQL, or TypeScript functions, apply it, and test it; see [Migrations](../migrations/getting-started).

- Drizzle ORM: `drizzle-kit generate` generates migrations from your table definitions ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-kit/src/cli/commands/migrate.ts#L302-L316)).
- Kysely: its `Migrator` applies migrations that you write ([docs](https://github.com/kysely-org/kysely/blob/v0.29.8/site/docs/migrations.mdx)).
- Prisma ORM: `prisma migrate dev` generates SQL migrations from your models ([docs](https://www.prisma.io/docs/cli/v7/migrate/dev)).
- Orchid ORM: you write migrations, or generate them from your tables with `db g` ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/generate-migrations.md)).

## Checking table definitions against the database

With kern-orm, check in a test that the database has what your table definitions rely on, such as their columns, keys, and foreign keys, while it may have more, such as other nullable columns; see [Tables that match the database](./testing#tables-that-match-the-database).

- Drizzle ORM: `drizzle-kit check` checks the files of its migrations, not the database ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-kit/src/cli/commands/check.ts#L4-L17)).
- Kysely: [kysely-codegen](https://github.com/RobinBlomberg/kysely-codegen/blob/0.20.0/README.md), a library of its own, generates TypeScript types from the database, and its `--verify` fails when the generated file is out of date.
- Prisma ORM: `prisma migrate diff` with `--exit-code` fails when the structure of the database differs from your models in anything that Prisma ORM supports, such as an extra column ([docs](https://www.prisma.io/docs/cli/v7/migrate/diff)).
- Orchid ORM: this comparison has not found such a check.
