# `query` of a `Database` as a property

`query` of a `Database` is a property of the type `SqlQueryTemplate`, which `queryOn` also returns, rather than a method with the same parameters.
So the signature of the template is written once, and the type tells that the template can be detached from its database, such as `const query = database.query`, as its implementation, a closure over the database, allows.

The alternatives:

- A method `query(strings: TemplateStringsArray, ...values: SqlValue[]): SqlQuery<InitialSqlQueryState>`, beside `queryOn` that returns `SqlQueryTemplate`, would keep the bivariant check of the parameters of a method.
  An object or a class that implements `Database` could declare `query` with parameters narrower than the template takes, and a subclass of a class typed as `new () => Database` could override `query` with a method, which TypeScript rejects for a property (TS2425).
  But it writes the signature twice, and kern-db neither creates a `Database` by a class nor documents implementing or wrapping one: code that wraps the execution of statements passes a `StatementExecutor` to `queryOn`.
  Should such a use appear, `query` can become a method with the same signature, and calls of the template keep their arguments and results.
- A method typed by the template, `query(...args: Parameters<SqlQueryTemplate>): ReturnType<SqlQueryTemplate>`, would write the signature once and keep the bivariant check.
  But with TypeScript 6.0, the emitted declarations keep it as `query(...args: Parameters<SqlQueryTemplate>): ReturnType<SqlQueryTemplate>`, and editors show its result as `ReturnType<SqlQueryTemplate>` rather than as the query that it returns.
