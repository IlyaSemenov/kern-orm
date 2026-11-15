# Queries of SQL text

## Rows of SQL text

A query of SQL text decodes each field from the result column of its key by the type of the field, and rejects a result without the column.

- Drizzle ORM, lacks: it types the rows of `execute` by a type argument that nothing checks ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/db.ts#L615-L634)).
- Kysely, lacks: it types the rows of `sql` by a type argument that nothing checks ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/raw-builder/sql.ts#L79)).
- Prisma ORM, differs: it types the rows of `$queryRaw` by a type argument that nothing checks ([docs](https://www.prisma.io/docs/orm/v7/prisma-client/using-raw-sql/raw-queries#typing-queryraw-results)), and its preview feature TypedSQL generates the types of the rows of a SQL file from the database ([docs](https://www.prisma.io/docs/orm/v7/prisma-client/using-raw-sql/typedsql)).
- Orchid ORM, lacks: it types the rows of `$query` by a type argument that nothing checks, over the values that its driver parses ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/orm-methods.md#query)).
