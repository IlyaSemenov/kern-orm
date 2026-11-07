# Queries

## A user `OR` and the condition of a relation

`where` adds to the filters of the user, which combine with the condition of a relation by `AND`, so a user `OR` never bypasses it.

- Orchid ORM, fails: a user `OR` bypassed the relation condition ([orchid-orm#845](https://github.com/romeerez/orchid-orm/issues/845)).

## A related value and a column under one key

A field of a nested query under the key of a column replaces the column in the result, and filters and `get` keep reading the column.

- Orchid ORM, fails: it typed a key that a relation value and a column share as their intersection ([orchid-orm#790](https://github.com/romeerez/orchid-orm/issues/790)).

## Literal fields

A literal field never reaches PostgreSQL: the result takes its value from code.

- Orchid ORM, differs: `sql.val` of its query builder, pqb, sends the value as a parameter and reads back what the driver gives, so the value has to survive the round trip ([source](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/packages/pqb/src/query/expressions/val-expression.ts)).

## The first row of each group

`distinctOn` of keys is a method apart from `distinct`, and rejects an empty list of keys.

- Kysely, same: `distinctOn` ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/query-builder/select-query-builder.ts#L413)).
- Drizzle ORM, same: `selectDistinctOn` ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/db.ts#L281)).
- Orchid ORM, differs: `distinct` takes the columns of `DISTINCT ON` ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/query-methods.md#distinct)).

## Row locks of a query that selects related records

A row lock locks only the rows of its own query, since a nested query is a subquery of the select list, so a query names no tables to lock.
After waiting for a row that another transaction changed, PostgreSQL evaluates the select list again, so the nested queries read and lock the related records of the new row.

- Orchid ORM 1.78.37, fails: it selects a relation with `LEFT JOIN LATERAL`, so its `forUpdate()` of such a query fails with "FOR UPDATE cannot be applied to the nullable side of an outer join" and must name the table, as `forUpdate(["idea"])` ([docs](https://github.com/romeerez/orchid-orm/blob/c4d62ea0e82f6d06c3b715fcf790113b2921a7ba/docs/src/guide/transactions.md#forupdate)); PostgreSQL does not read the row of the join again after the wait, so its query gives and locks only the related record of the old row.

## Row locks without waiting

The `noWait` option of a row lock adds `NOWAIT`, such as `forUpdate({ noWait: true })`.

- Orchid ORM, fails: its `noWait()` compiles to `NO WAIT`, which PostgreSQL 18 rejects as a syntax error ([source](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/packages/pqb/src/query/basic-features/for/for.ts#L13)).
