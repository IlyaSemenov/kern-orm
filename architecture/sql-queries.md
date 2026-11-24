# Queries of SQL text

- **Query of SQL text** (`sql/query.ts`): immutable query of a statement of the database layer, which `query` of a `Database` and `$query` of a `Db` start, as a `SqlQuery` of a source of its statement and of the plan of its result, which `select`, `get`, `pluck`, `take`, `optional`, and `nullable` change.
  - The source compiles the statement each time the query executes or `toSQL` compiles it; awaiting the query executes the statement with `execute` of its database and decodes the result by the plan.
  - A statement that fails to compile rejects the promise of the query without executing.
  - `query` of a `Database` compiles a template of `sql` of the layer with `compileFragment`, so it takes its fragments and no table, expression, or query of the ORM.
  - `$query` of a `Db` compiles the raw SQL node of its template, as `sql` builds it, with the lowering and compilation of the `Db` (`lowerTextStatement` and `compileTextStatement`), so that its interpolated tables are named in the PostgreSQL schema that the `Db` resolves at each compilation, and the queries interpolated into it, such as of `exists` in a condition, are lowered and checked against the `Db`.
    The source holds the `Db` in its closure: the query has no `Db` or node of the ORM.
- `$execute` and `$compile` of a `Db` reject a query of SQL text before they read a node, since it has none.
- The ORM recognizes a query of SQL text by its class, since the class has no method of the operands of the ORM: it cannot be nested in a selection, used as an operand of an expression, such as an insert or update value or a condition, or interpolated into `sql`.
- The template of `$query` interpolates values as `sql` does, as [types](types.md#parameters-and-sql-fragments) describe, and the template of `query` as `sql` of the [database layer](types.md#sql-fragments-of-the-database-layer); either runs as one statement with parameters.

## Results

- A query resolves to the number of the rows of the command tag of its statement, as a mutation without `RETURNING` does; `select` returns records instead, and `get` and `pluck` values, decoded by the types they take, also of the ORM.
  - `take`, `optional`, and `nullable` change the rows mode as for a query of a table, before or after a selection; before a selection, they check the number of the rows as for a mutation of one row.
  - `take` adds no limit, since kern-db does not change the text of a statement, so a query of one row rejects several rows.
  - Types cannot check what the statement returns: the type of a field declares the values of its column, including whether it is nullable, as `sql(type)` does, and decoding keeps `NULL` as `null`, or as the value that the type [decodes `NULL` to](types.md), whether or not the type is nullable.
    A field of a type with a [read expression](types.md) decodes the result of the expression, so the statement must select the field by it.
- The database layer decodes the result by a flat plan (`decodeFlatResult` of `result.ts`), which has no nested rows, literals, or conversions; its only nested records are those of the [columns of records](#columns-of-records), read from result columns of their own.
- Records are read by matching the name of each field to `name` of each result column, rather than by position: the statement chooses the order of its columns, and two columns of one type in another order would decode silently.
  The name of a field of a type is its key, and the fields of the [columns of a record](#columns-of-records) have the names that their fragment gives its result columns.
  - The positions are resolved once per result, before its rows are decoded.
    Up to four fields, or fewer than 256 field-to-column comparisons, use scans; larger lookups build a result-local index of only the selected names ([decision](../decisions/sql-queries/result-column-lookup.md)).
  - A missing column, or a column that the result has twice, rejects with `ResultDecodeError`; other columns are ignored, such as those of `RETURNING *`.
  - A value of `get` and `pluck` is read from the only column, whatever its name, and another number of columns rejects.
  - Decoding fails after the statement, so a statement that changes rows has made its change, as a mutation has ([decision](../decisions/sql-queries/columns-of-sql-text.md)).

## Columns of records

- **Columns of a record** (`sql/columns.ts`): a `SqlColumns`, the list of the result columns of a record that a statement selects, such as of a row of a table, with the fields that read the record from them.
  - It is a [SQL fragment](types.md#sql-fragments-of-the-database-layer) without parameters, so every template interpolates it, also of a script, and `text` gives its SQL for a statement built as text.
  - The fragment selects each column under the name of a result column of its own, the key of the column after the prefix of the columns, such as `"j"."run_at" AS "job__runAt"`, so that the record has the keys of its columns whatever their names in SQL, and the result columns of several records of one statement must have different names, such as by prefixes of their own, which a selection checks ([decision](../decisions/sql-queries/result-columns-of-records.md)).
    The prefix is the alias that qualifies the columns unless they take another, since the sources of a statement already differ by their aliases; columns without both name a result column by its key alone.
  - The fragment selects a column of a type with a [read expression](types.md) by the expression, such as `extract(epoch from "j"."run_at") AS "j__runAt"`, whose result the type decodes.
    The result column of a column of the key is `NULL` exactly when the column is, by the contract of the expression, so it tells a missing row as the column would.
  - A statement must select the columns by the fragment or its text; a list written by hand must give the same names to its result columns, and select the same expressions.
  - `createSqlColumns` of the [builder API](sql.md) creates it from the columns of a source of a query builder, with the alias that qualifies them and the prefix, typed by the record of the columns that it takes; it rejects a column twice, a key that a record cannot have, a name of a result column that may take more than the 63 bytes that PostgreSQL keeps in a server encoding, counted as the [identifiers of the compiler](sql.md#statements) are, and a name that is not well-formed, which a driver changes when it encodes the statement.
  - Only `createSqlColumns` creates it: no entry point exports its class as a value, and its text and fields are frozen, so that the SQL of the columns cannot differ from what a selection reads.
  - `RecordOf` names the record that the columns read from one row, as `select` decodes it for their field, `null` included for the columns of `nullable` ([decision](../decisions/sql-queries/record-of-columns.md)).
  - The record requires a column only when the list guarantees its key, by the rule of `select` of a query by keys (`selected-columns.ts` of `kern-db`, [decision](../decisions/queries/dynamic-column-keys.md)): the column of a union of columns or of keys, of a spread array, or of a key typed as `string` or another index key is optional, a column of one known key written before or after a spread is required, and a union of lists makes a union of records, each of the values of its own columns.
    A key has the values of every column of the list that names it, whatever their positions, and a key of an index signature, `string` or a template, those of every column, so that types need not compare the names that it may have with the keys of the other columns ([decision](../decisions/sql-queries/values-of-columns-by-key.md)).
    A key must be typed as string literals, `string`, or a template: types do not tell which columns a key of another type, such as a branded `string` or a member of a string enum, may name ([decision](../decisions/queries/string-literal-column-keys.md)).
    Columns whose keys are all typed as `string`, such as of `SqlColumn[]`, make a record of any keys.
  - Its options tell in types whether the columns have their key: `true` for a key that is a non-empty tuple, such as written in the call, `false` without one, and `boolean` for options whose type does not tell, such as options that may be missing or a key of an array type.
    With `boolean`, types let `nullable` go without `by`, which then rejects at runtime when the columns have no key.
    `true` holds for every list of the columns, also of a union of lists, since `createSqlColumns` rejects a column of the key that the columns do not include when it creates them.
- `select` takes the columns of a record as a field, which is a record of its own under the key of the field: a group of the fields of the flat plan, read from the result columns of their names.
  - A later selection replaces a group as a whole under its key, as it replaces a field of a type.
  - A selection rejects fields that read one result column, such as the columns of two records without prefixes that share a key, when it is made: the statement cannot return a column of that name for each.
  - A field of a group decodes `NULL` as any other field does, whatever its type.
- `nullable` of the columns makes their record `null` without its row, such as of a table joined with `LEFT JOIN`, which decoding tells by the result columns of the key of the record being all `NULL`, without decoding the others ([decision](../decisions/sql-queries/missing-row-by-key-columns.md)).
  - The key is the columns that `createSqlColumns` takes as never `NULL` in a row, such as a primary key; columns without all of them, or without a key, require the columns in `by`.
  - A column of the key or of `by` must be among the columns and must not be nullable, since its `NULL` would read as a missing row.
    Types reject in `by` a column whose values include `null` and a column that is optional in any record of a union of records, which the fragment may not select, and take one whose values are `unknown`, such as of a JSON column, and one of a type of the database layer that decodes `NULL` to a value other than `null`, such as `string | undefined`, which only their types tell, and a key of an index signature, which `nullable` checks at runtime.
    The presence of a record is told by the `NULL` of its result columns before they are decoded, so a field of a type that decodes `NULL` to a value reads as that value in a record that has its row.
    A record of an index signature of `string` has no known keys for types to tell apart: they take any key in `by`, or none when the values of the index signature are known to include `null`.
  - A row with only some of these columns `NULL` rejects with `ResultDecodeError` of the path of the group.
- `columnsOf` of the ORM (`query/columns-of.ts`) creates the columns of a table or view, of a query of a table without clauses, such as `db.form`, or of its definition, by the physical names and the types of its columns: all of them for `"*"`, or those of a list of keys in their order.
  - The columns to select are required, so that a call chooses them explicitly, as a query returns only explicitly selected fields.
  - The record requires a column of a list only when the list guarantees its key, as that of `createSqlColumns`.
    Types take an empty list, which rejects when the columns are created: a check of the list would reject a list of a type parameter that a function passes on.
    Its return type is `NoInfer`, so that a call in a field of `select` does not infer the columns from the type of the field too, which triples the instantiations of such a query ([decision](../decisions/sql-queries/columns-of-return-type.md)).
  - Their key is the primary key of the table when the columns include all its columns; a view has none.
    In types, selecting all the columns includes the primary key of the table, if it has one.
    An explicit list includes it only when it guarantees each column of the primary key, in every list of a union of lists: a key typed as an index key, such as `string` of a table of any columns or `` `key${number}` ``, may name another column.
  - It rejects another query of the table, whose rows the statement does not have.
  - The columns are read by a query of SQL text only: a query of a table selects its fields itself.

## Scripts

- `$script` of a `Db` and `script` of a `Database` execute a script of several statements at once, through the driver, without a query object or a result: PostgreSQL takes several statements only without parameters.
- A template of `$script` compiles as the statement of `$query` and rejects a value that becomes a parameter, also in a query or a `sql` fragment that it interpolates, before it runs; it names the tables of the `Db` as `$query` does.
- A template of `script` of a `Database` is a template of `sql` of the [database layer](types.md#sql-fragments-of-the-database-layer), which takes its fragments, such as a name of `identifier`, and no expression, query, or table of the ORM.
  It rejects a parameter at any depth of its fragments before the driver gets the script, and a value that it does not take by rejecting its promise.
- PostgreSQL runs a script outside a transaction in one implicit transaction, and a script in a transaction in that transaction.
  A script must not start or end a transaction, such as with `COMMIT`: that would end the transaction that the coordinator tracks.
  Outside a transaction, the driver rejects a script that leaves a transaction open, under the [driver contract](drivers.md).
