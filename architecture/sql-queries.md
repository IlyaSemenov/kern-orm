# Queries of SQL text

- **Query of SQL text** (`query/sql-query.ts`): immutable statement of a template, which `$query` of a `Db` and `query` of a `Database` start, as a `SqlQuery` over a text statement node (`TextStatementNode` of `ast/nodes.ts`), which lowering keeps as it is, except that it lowers the queries in the expressions interpolated into it, such as of `exists` in a condition.
  It is a class apart from `SelectQuery`, like `MutationQuery`, with the methods that return the rows of its statement, since no table describes them.
  It is always bound and executes on its `Db` when awaited, so that its interpolated tables are named in the PostgreSQL schema of the `Db`.
  `query` of a `Database` starts it on a `Db` of no tables, so it names no tables.
- The template interpolates values as `sql` does, as [types](types.md#parameters-and-sql-fragments) describe, and runs as one statement with parameters.
- Queries of SQL text cannot be nested in a selection, used as insert or update values, or interpolated into `sql`.

## Results

- A query resolves to the number of the rows of the command tag of its statement, as a mutation without `RETURNING` does; `select` returns records instead, and `get` and `pluck` values, decoded by the types they take.
  - `take`, `optional`, and `nullable` change the rows mode as for a query of a table, before or after a selection; before a selection, they check the number of the rows as for a mutation of one row.
  - `take` adds no limit, since kern-orm does not change the text of a statement, so a query of one row rejects several rows.
  - Types cannot check what the statement returns: the type of a field declares the values of its column, including whether it is nullable, as `sql(type)` does, and decoding keeps `NULL` as `null` whatever the type.
- Records are read from the result columns by the keys of their fields, as the driver names the columns, rather than by position: the statement chooses the order of its columns, and two columns of one type in another order would decode silently.
  - A missing column, or a column that the result has twice, rejects with `ResultDecodeError`; other columns are ignored, such as those of `RETURNING *`.
  - A value of `get` and `pluck` is read from the only column, whatever its name, and another number of columns rejects.
  - Decoding fails after the statement, so a statement that changes rows has made its change, as a mutation has ([decision](../decisions/sql-queries/columns-of-sql-text.md)).

## Scripts

- `$script` of a `Db` and `script` of a `Database` execute a script of several statements at once, through the driver, without a query object or a result: PostgreSQL takes several statements only without parameters.
- A template of `$script` compiles as the statement of a query of SQL text and rejects a value that becomes a parameter, also in a query or a `sql` fragment that it interpolates, before it runs; it names the tables of the `Db` as `$query` does.
- A template of `script` of a `Database` is a template of `sql` of the [database layer](types.md#sql-fragments-of-the-database-layer), which takes its fragments, such as a name of `identifier`, and no expression, query, or table of the ORM.
  It rejects a parameter at any depth of its fragments before the driver gets the script, and a value that it does not take by rejecting its promise.
- PostgreSQL runs a script outside a transaction in one implicit transaction, and a script in a transaction in that transaction.
  A script must not start or end a transaction, such as with `COMMIT`: that would end the transaction that the coordinator tracks.
  Outside a transaction, the driver rejects a script that leaves a transaction open, under the [driver contract](drivers.md).
