# `identifier` as a function of its own

`identifier` is a function of its own, as `sql` and `param` are.

- Drizzle ORM ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/sql/sql.ts)) and Slonik ([docs](https://github.com/gajus/slonik/blob/slonik@49.13.0/README.md#sqlidentifier)) have it as `sql.identifier`, and Kysely as `sql.id` ([docs](https://github.com/kysely-org/kysely/blob/v0.29.8/src/raw-builder/sql.ts#L271)).
