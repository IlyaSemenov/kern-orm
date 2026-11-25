# `$queryOn` of a `Db`

`$queryOn` of a `Db` takes a `StatementExecutor` and returns the template of `$query` on it, as `queryOn` of `kern-db` returns the template of `query` of a `Database` on it.
So a statement that must run on a driver, a connection, or a wrapper of `execute` names the tables of the `Db` as `$query` does, in the PostgreSQL schema that the `Db` resolves when the statement compiles, rather than by `identifier` with the schema and the name of each table.

```ts
await db.$queryOn(connection)`UPDATE ${db.job} SET locked_by = ${worker} WHERE id = ${jobId}`
```

The alternatives:

- A method of a query of SQL text that replaces its executor, such as ``db.$query`…`.on(connection)``, would let a helper return a query and its caller choose where it runs, and would serve the queries of `query` of a `Database` too.
  But every query of SQL text would have it, also one whose executor its author chose, so a query could run outside the transaction that its author expected; and a query of a `Database` and of a `Db` would differ from `queryOn`, which takes the executor before the statement.
- A `Db` bound over an executor, such as `bindSchema(schema, connection)`, would run every query of the `Db`, also of a table, on the executor.
  But `bindSchema` takes a `Database`, whose transactions, sessions, and locks have no meaning over a connection or a wrapper of `execute`, as [`queryOn` of an executor](query-on-an-executor.md) weighs for a `Database` over each executor.
- `queryOn` of `kern-orm`, whose template takes the tables of a `Db` and compiles the statement by the `Db` of its tables, would need no `Db` at hand.
  But a statement of the tables of two `Db`s would have no one `Db` to check and compile it by, even when both `Db`s place their tables in the same PostgreSQL schema.
