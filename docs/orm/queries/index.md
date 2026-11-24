# Queries

Start a query from a table of a `Db`, such as `db.form`, and await it to execute it:

```ts
const forms = await db.form.where({ published: true }).select("id", "name")
// forms: { id: string; name: string }[]
```

A method never changes the query it is called on, so a query can be extended in several ways without affecting the others.
Each `await` executes the query again; see [Reusable queries](./composing#reusable-queries).

## Guides

- [Selecting](./selecting): choose the fields of records, take one row, get plain values, check whether rows exist, load several queries at once, or convert results in code.
- [Filtering](./filtering): find records by column values, operators, related records, values of other queries, and SQL conditions.
- [Related Records](./relations): load the related records of each row in the same query.
- [Sorting and Pagination](./sorting): sort rows by columns, expressions, and related records, and get them page by page.
- [Inserting, Updating, and Deleting](./mutations): change records and get the fields of the changed ones.
- [Aggregates and Grouping](./aggregates): count rows and compute other aggregates, also of each group of rows, and filter and sort the groups by them.
- [Expressions](./expressions): replace `NULL`, take the largest or the smallest of several values, choose a value by conditions, select a constant, or define an expression once and reuse it across queries.
- [Operators](./operators): see which operators each type has for conditions and computed values.
- [Composing and Reusing Queries](./composing): add clauses conditionally, share clauses across queries of a table, or reuse a query, also with a `Db` known only at runtime.
- [SQL Statements](./sql): run SQL that queries do not cover, such as an upsert, get its rows, or run a script of several statements.

## `catch` and `finally`

A query has `catch` and `finally` of a Promise, and calling either executes the query as `await` does.
This also applies to the queries of [`db.$query`](./sql).

```ts
const forms = await db.form
  .where({ published: true })
  .select("id", "name")
  .catch(handleError)
  .finally(cleanup)
```

This chain executes the query once, because `finally` is called on the Promise that `catch` returns.
A statement that PostgreSQL rejects aborts its transaction also when `catch` handles the error; see [Errors](../errors).

A query is not a Promise: building it executes nothing, and each `await` and each call of `then`, `catch`, or `finally` of the query itself executes it again, in the [transaction](../transactions) that is current at that moment.
To pass a query where a `Promise` is required, call its `then()`, which executes it and returns the Promise of its result, such as `db.form.count().then()`.

## Comments

To find the statement of a query in PostgreSQL, such as in `pg_stat_activity` or in the log of slow statements, label it with `comment`, which starts its SQL with the label in a comment:

```ts
const forms = await db.form
  .where({ published: true })
  .select("id", "name")
  .comment("forms:published")
// SQL: /* forms:published */ SELECT ...
```

Give each operation a short label that stays the same on every call, so that one filter finds all its statements, such as `WHERE query LIKE '/* forms:published */%'` in `pg_stat_activity`.

Queries of tables, [`$select`](./selecting#several-queries-at-once), and [`$query`](./sql#comments), as well as inserts, updates, and deletes, take a comment.
The queries that you derive from a query with a comment keep it, such as `db.form.find(id).comment("forms:save").update(values)`; a later `comment` replaces it, and `comment(null)` removes it.

Only the query that runs the statement writes its comment: a query nested in another one, such as in a selection or in `in`, leaves its comment out.

`pg_stat_statements` ignores comments when it groups statements, so statements that differ only in their comments share one entry, which shows the text of the first of them, with its comment or without one.
