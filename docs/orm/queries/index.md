# Queries

Start a query from a table of a `Db`, such as `db.form`, and await it to execute it:

```ts
const forms = await db.form.where({ published: true }).select("id", "name")
// forms: { id: string; name: string }[]
```

A method never changes the query it is called on, so a query can be extended in several ways without affecting the others.

## Guides

- [Selecting](./selecting): choose the fields of records, take one row, get plain values, check whether rows exist, load several queries at once, or convert results in code.
- [Filtering](./filtering): find records by column values, operators, related records, values of other queries, and SQL conditions.
- [Related Records](./relations): load the related records of each row in the same query.
- [Sorting and Pagination](./sorting): sort rows by columns, expressions, and related records, and get them page by page.
- [Inserting, Updating, and Deleting](./mutations): change records and get the fields of the changed ones.
- [Aggregates and Grouping](./aggregates): count rows and compute other aggregates, also of each group of rows, and filter and sort the groups by them.
- [Expressions](./expressions): replace `NULL`, take the largest or the smallest of several values, choose a value by conditions, select a constant, or define an expression once and reuse it across queries.
- [Operators](./operators): see which operators each type has for conditions and computed values.
- [Composing Queries](./composing): add clauses conditionally, or define them once and reuse them across queries of a table.
- [Reusable Queries](./reusable): define a query once and execute it in several places, also with a `Db` known only at runtime.
- [SQL Statements](./sql): run SQL that queries do not cover, such as an upsert, get its rows, or run a script of several statements.

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

Queries of tables, of [`$select`](./selecting#several-queries-at-once), and inserts, updates, and deletes take a comment; write the comment of a [SQL statement](./sql) in its SQL.
The queries that you derive from a query with a comment keep it, such as `db.form.find(id).comment("forms:save").update(values)`; a later `comment` replaces it, and `comment(null)` removes it.

Only the query that runs the statement writes its comment: a query nested in another one, such as in a selection or in `in`, leaves its comment out.

`pg_stat_statements` ignores comments when it groups statements, so statements that differ only in their comments share one entry, which shows the text of the first of them, with its comment or without one.
