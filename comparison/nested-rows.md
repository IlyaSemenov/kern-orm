# Nested rows

## Related records in one statement

A query selects the related records of each row, at any depth, as subqueries of its select list in one statement, typed from the selection.

- Drizzle ORM, same: its relational queries select each relation as a `LEFT JOIN LATERAL` subquery aggregated to JSON, in one statement ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/dialect.ts#L1313-L1372), [changelog](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/changelogs/drizzle-orm/0.28.0.md)).
- Kysely, differs: it has no relations, and a query nests a correlated subquery of each relation by hand in `jsonArrayFrom` or `jsonObjectFrom` ([docs](https://github.com/kysely-org/kysely/blob/v0.29.8/site/docs/recipes/0001-relations.md), [source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/helpers/postgres.ts#L59-L62)).
- Prisma ORM, differs: `include` loads relations in one statement of `LATERAL` joins only with the preview feature `relationJoins`, and in a query per table otherwise ([docs](https://www.prisma.io/docs/orm/v7/prisma-client/queries/relation-queries#relation-load-strategies-preview), [source](https://github.com/prisma/prisma/blob/7.10.1/packages/client-generator-ts/src/TSClient/Model.ts#L517)).
- Orchid ORM, same: it selects each relation as a `LEFT JOIN LATERAL` subquery aggregated to JSON, in one statement ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/join.md#L37), [source](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/packages/pqb/src/query/basic-features/json/json.utils.ts#L58-L62)).

## A missing record, `NULL`, and an empty array

A nested value tells apart a missing row, `NULL`, and an empty array, at any depth and through a helper.

- Orchid ORM, fails: a nested array value inside `select` could not tell `null`, an empty array, and a missing record apart, nor a missing record and `NULL` of a value nested three levels deep ([orchid-orm#830](https://github.com/romeerez/orchid-orm/issues/830)).

## A related value selected twice under one key

A related value that a later selection replaces under its key decodes once.

- Orchid ORM, fails: selecting a relation value twice under one key unwrapped it twice ([orchid-orm#792](https://github.com/romeerez/orchid-orm/issues/792)).
