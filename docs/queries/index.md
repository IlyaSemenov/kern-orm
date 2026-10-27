# Queries

Start a query from a table of a `Db`, such as `db.form`, and await it to execute it:

```ts
const forms = await db.form.where({ published: true }).select("id", "name")
// forms: { id: string; name: string }[]
```

A method never changes the query it is called on, so a query can be extended in several ways without affecting the others.

## Guides

- [Selecting](./selecting): choose the fields of records, take one row, or get plain values.
- [Filtering](./filtering): find records by column values, operators, and SQL conditions.
- [Sorting and Pagination](./sorting): sort rows by columns and expressions, and get them page by page.
- [Related Records](./relations): load the related records of each row in the same query.
- [Composing Queries](./composing): add clauses conditionally, or define them once and reuse them across queries of a table.
- [Reusable Queries](./reusable): define a query once and execute it in several places, also with a `Db` known only at runtime.
