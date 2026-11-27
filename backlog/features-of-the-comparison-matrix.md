# Features of the comparison matrix

Fill the matrices of [docs/orm/comparison.md](../docs/orm/comparison.md) and [docs/migrations/comparison.md](../docs/migrations/comparison.md) with the rows that the [rules of the site](../development/user-documentation.md#site) choose.
Start with the matrix of migrations, whose domain is smaller.

## Steps

1. Go through every page of the site of the Kern library of the matrix and add a row of each capability that users meet, with the cell of the Kern library alone: everyday capabilities, such as rolling back migrations, beside those that set the Kern library apart.
2. Go through the main sections of the documentation of each project of the matrix and add rows of its capabilities that the Kern library lacks.
3. Group the rows consistently, and merge rows that judge the same capability.
4. Record how every project of the matrix handles each row, as [Writing a record](../comparison/README.md#writing-a-record) requires, and fill its cells.
   Review a row for every project of the matrix together rather than for one of them, such as Orchid ORM, so that the columns rest on research of the same depth.
   For a feature that the documentation of a project states plainly, its documentation is evidence enough.

## Inventory of the ORM

Capabilities of kern-orm to add as rows, by group, beside the existing rows:

- General: Node.js and Bun, no code generation, several drivers of PostgreSQL.
- Tables: composite primary and unique keys, column names apart from keys, sequences.
- Queries: typed selections, queries of one value, queries of existence, distinct rows, a record by a unique key.
- Relations: relations `one` and `many` at any depth, filtered relations, sorting and pages of the related records of each record.
- Related values: aggregates of related records, conditions on related records, sorting by aggregates of related records.
- Composing queries: conditional clauses, reusable queries and helpers with `ResultOf`, queries defined from a schema without a `Db`.
- Filters: typed operators, `AND` and `OR` groups, queries as values, reusable conditions.
- Pages: offset pages and pages with their total count, beside the existing row of keyset pages.
- Aggregates: `count`, `sum`, `avg`, `min`, `max`, groups, `HAVING`, sorting by aggregates.
- Mutations: inserts of one and of many records, updates, deletes, `RETURNING`, conflicts, related records selected by a mutation.
- Safety of mutations: updates without values.
- Types: custom types and operators, presets of types, typed JSON values, decoding of `NULL`.
- Schemas: shared tables beside the schemas of tenants, queries shared by several Dbs.
- Transactions: isolation levels, the search path and the lock timeout of a transaction.
- Locks and sessions: advisory locks, row locks, reserved sessions.
- SQL statements: typed fragments, queries in statements, scripts.
- Testing: nested fixtures, failed statements of a test, browser tests in the transaction of a test, tests of locks.
- Interoperability: transactions of other libraries, gradual moving from Orchid ORM, a pool shared with another library.

Also add rows of the guarantees of kern-orm that comparison/ records only as past issues of Orchid ORM: empty groups of conditions and empty lists of `IN`, updates and deletes rejected without a restriction, and late work of a finished test.

## Inventory of migrations

The inventory of [Migrations](../docs/migrations/getting-started.md) is complete; continue with steps 2 to 4.

Review first, for every migrator, the rows where kern-migrations may differ from rake-db: `schemas-at-once`, `separate-histories`, `package-migrations`, `outside-transaction-inside-one`, `custom-helpers`, and `verifying-rollbacks`.

Check in the listed versions the past issues of rake-db, Drizzle ORM, and Kysely that [comparison/migrations.md](../comparison/migrations.md) records, such as of locks and of migrating inside a transaction, for the cells of their rows.

## Other work

- Record the requests of features that the maintainers of a project declined, such as of Orchid ORM, which the matrix shows as `declined`.
- Add a matrix of kern-db once comparison/ covers it, against Slonik and against a client of PostgreSQL used directly, and link it with the other matrices by their lines of links.
