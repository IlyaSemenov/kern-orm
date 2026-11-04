# Queries

Start a query from a table of a `Db`, such as `db.form`, and await it to execute it:

```ts
const forms = await db.form.where({ published: true }).select("id", "name")
// forms: { id: string; name: string }[]
```

A method never changes the query it is called on, so a query can be extended in several ways without affecting the others.

## Guides

- [Selecting](./selecting): choose the fields of records, take one row, get plain values, count rows and compute other aggregates, check whether rows exist, or load several queries at once.
- [Filtering](./filtering): find records by column values, operators, related records, values of other queries, and SQL conditions.
- [Sorting and Pagination](./sorting): sort rows by columns, expressions, and related records, and get them page by page.
- [Related Records](./relations): load the related records of each row in the same query.
- [Computed Values](./computed-values): replace `NULL`, take the largest or the smallest of several values, choose a value by conditions, or select a constant.
- [Inserting, Updating, and Deleting](./mutations): change records and get the fields of the changed ones.
- [Composing Queries](./composing): add clauses conditionally, or define them once and reuse them across queries of a table.
- [Reusable Queries](./reusable): define a query once and execute it in several places, also with a `Db` known only at runtime.
- [SQL Statements](./sql): run SQL that queries do not cover, such as an upsert, get its rows, or run a script of several statements.
