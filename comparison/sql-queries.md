# Queries of SQL text

## Rows of SQL text

A query of SQL text decodes each field from the result column of its key by the type of the field, and rejects a result without the column.

- Drizzle ORM, lacks: it types the rows of `execute` by a type argument that nothing checks ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/db.ts#L615-L634)).
- Kysely, lacks: it types the rows of `sql` by a type argument that nothing checks ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/raw-builder/sql.ts#L79)).
- Prisma ORM, differs: it types the rows of `$queryRaw` by a type argument that nothing checks ([docs](https://www.prisma.io/docs/orm/v7/prisma-client/using-raw-sql/raw-queries#typing-queryraw-results)), and its preview feature TypedSQL generates the types of the rows of a SQL file from the database ([docs](https://www.prisma.io/docs/orm/v7/prisma-client/using-raw-sql/typedsql)).
- Orchid ORM, lacks: it types the rows of `$query` by a type argument that nothing checks, over the values that its driver parses ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/orm-methods.md#query)).

## SQL text on a connection of the caller

`queryOn` starts a query of SQL text on any object that executes statements, such as a driver, a reserved connection, or a wrapper that records each statement, with the template and the typed results of `query` of a `Database`.

- Kysely, differs: ``sql`…`.execute(db)`` runs a fragment on any provider of an executor, such as a `Kysely` or its transaction ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/raw-builder/raw-builder.ts#L139-L142)).
- Postgres.js, differs: `sql.reserve()` returns the template of a reserved connection ([source](https://github.com/porsager/postgres/blob/v4.1.0/src/index.js#L183-L191)), as `sql.begin` passes the template of a transaction to its callback ([source](https://github.com/porsager/postgres/blob/v4.1.0/src/index.js#L269)).
- Drizzle ORM, differs: `execute` is a method of a database ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/db.ts#L615-L634)), which the transaction that `transaction` passes to its callback is too ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/session.ts#L236-L240)).
