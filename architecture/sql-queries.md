# Queries of SQL text

- **Query of SQL text** (`database/sql/query.ts`): immutable query of a statement of the database layer, which `query` of a `Database` and `$query` of a `Db` start, as a `SqlQuery` of a source of its statement and of the plan of its result, which `select`, `get`, `pluck`, `take`, `optional`, and `nullable` change.
  - The source compiles the statement each time the query executes or `toSQL` compiles it; awaiting the query executes the statement with `execute` of its database and decodes the result by the plan.
  - A statement that fails to compile rejects the promise of the query without executing.
  - `query` of a `Database` compiles a template of `sql` of the layer with `compileFragment`, so it takes its fragments and no table, expression, or query of the ORM.
  - `$query` of a `Db` compiles the raw SQL node of its template, as `sql` builds it, with the lowering and compilation of the `Db` (`lowerTextStatement` and `compileTextStatement`), so that its interpolated tables are named in the PostgreSQL schema that the `Db` resolves at each compilation, and the queries interpolated into it, such as of `exists` in a condition, are lowered and checked against the `Db`.
    The source holds the `Db` in its closure: the query has no `Db` or node of the ORM.
- `$execute` and `$compile` of a `Db` reject a query of SQL text before they read a node, since it has none.
- The ORM recognizes a query of SQL text by its class, since the class has no method of the operands of the ORM: it cannot be nested in a selection, used as an operand of an expression, such as an insert or update value or a condition, or interpolated into `sql`.
- The template of `$query` interpolates values as `sql` does, as [types](types.md#parameters-and-sql-fragments) describe, and the template of `query` as `sql` of the [database layer](types.md#sql-fragments-of-the-database-layer); either runs as one statement with parameters.

## Results

- A query resolves to the number of the rows of the command tag of its statement, as a mutation without `RETURNING` does; `select` returns records instead, and `get` and `pluck` values, decoded by the codecs they take, which include the types of the ORM.
  - `take`, `optional`, and `nullable` change the rows mode as for a query of a table, before or after a selection; before a selection, they check the number of the rows as for a mutation of one row.
  - `take` adds no limit, since kern-orm does not change the text of a statement, so a query of one row rejects several rows.
  - Types cannot check what the statement returns: the codec of a field declares the values of its column, including whether it is nullable, as `sql(type)` does, and decoding keeps `NULL` as `null` whatever the codec.
- The database layer decodes the result by a flat plan (`decodeFlatResult` of `database/result.ts`), which has no nested rows, literals, or conversions.
- Records are read from the result columns by the keys of their fields, as the driver names the columns, rather than by position: the statement chooses the order of its columns, and two columns of one type in another order would decode silently.
  - A missing column, or a column that the result has twice, rejects with `ResultDecodeError`; other columns are ignored, such as those of `RETURNING *`.
  - A value of `get` and `pluck` is read from the only column, whatever its name, and another number of columns rejects.
  - Decoding fails after the statement, so a statement that changes rows has made its change, as a mutation has ([decision](../decisions/sql-queries/columns-of-sql-text.md)).

## Scripts

- `$script` of a `Db` and `script` of a `Database` execute a script of several statements at once, through the driver, without a query object or a result: PostgreSQL takes several statements only without parameters.
- A template of `$script` compiles as the statement of `$query` and rejects a value that becomes a parameter, also in a query or a `sql` fragment that it interpolates, before it runs; it names the tables of the `Db` as `$query` does.
- A template of `script` of a `Database` is a template of `sql` of the [database layer](types.md#sql-fragments-of-the-database-layer), which takes its fragments, such as a name of `identifier`, and no expression, query, or table of the ORM.
  It rejects a parameter at any depth of its fragments before the driver gets the script, and a value that it does not take by rejecting its promise.
- PostgreSQL runs a script outside a transaction in one implicit transaction, and a script in a transaction in that transaction.
  A script must not start or end a transaction, such as with `COMMIT`: that would end the transaction that the coordinator tracks.
  Outside a transaction, the driver rejects a script that leaves a transaction open, under the [driver contract](drivers.md).
