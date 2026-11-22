# Keys of view results

Consider keys on a read-only view when an application needs `findBy` or a relation `one` to rows that its query makes unique, such as a summary grouped by form and field type.
The declaration would express a guarantee of the query that the PostgreSQL catalog cannot verify.

Prisma ORM accepts `@unique` and `@@unique` on views for relations, cursor pagination, and `findUnique`; it leaves uniqueness to the author of the view ([docs](https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/views#unsafe-unique-attributes)).
