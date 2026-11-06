# Mutations

- **Mutation** (`query/mutation.ts`): immutable insert, update, or delete of a table, which `insert`, `insertMany`, `update`, and `delete` of a select query start, as a `MutationQuery` over the semantic mutation node (`MutationNode` of `query/node.ts`).
  It is a class apart from `SelectQuery`, like `RecordQuery`, with the members that differ by kind, `toSQL`, the methods that return the fields of the changed rows, `select`, `get`, and `pluck`, those that convert them, `map` and `transform`, and `use`, since the methods of a select query do not apply to it.
  It is covariant in its state and its kind, like `SelectQuery`, and of the same two kinds: an unbound mutation starts from a schema and executes with `$execute`, and a bound one starts from a `Db` and executes when awaited.
- **Values** (`query/values.ts`): the records of an insert and the values of an update, their types, and their nodes.
- Lowering and the compiler turn a mutation into an `INSERT`, `UPDATE`, or `DELETE` statement of the SQL AST, as [SQL generation](sql.md) describes.

## Rows to change

- `insert` and `insertMany` apply only to a query of a table without clauses: no relation, filters, selected fields, order, limit, offset, `distinct`, rows other than `many`, or `all`.
  `insert` changes rows `one` and `insertMany` rows `many`.
- `update` and `delete` change the rows that the filters of the query choose, in the rows mode of the query, such as `one` of `find` or `optional` after `optional`.
  They reject a query of a relation, a query with selected fields, which a mutation selects after it, and a query with an order, a limit, an offset, or `distinct`: PostgreSQL has no limit or order of the rows of `UPDATE` and `DELETE`, so a query of `take` would change every row it filters.
  `find` and `findBy` add no limit, since the values of a key match at most one row, so a mutation of their query changes its row, and tells it from a query of `take`; a value that depends on the row, such as ``find(sql`id`)``, may match several, which the mutation changes before it rejects them.
- `update` and `delete` require an effective restriction or `all`: they reject a query whose filters combine into `TRUE`, such as of `where({})`, unless `all` allows it ([orchid-orm#847](https://github.com/romeerez/orchid-orm/issues/847), [#854](https://github.com/romeerez/orchid-orm/issues/854)).
  - A filter that matches no row, such as `in([])`, which is `FALSE`, restricts the rows, and so does a SQL fragment, whose text kern-orm does not read.
  - `all` applies to a query of many rows and is recorded by the node of the query; a later filter restricts the rows as without it.
  - Types do not check the restriction: `where` keeps the state of a query whose row is not guaranteed, so that a union of queries takes it, and types cannot tell `where({})` from a filter.

## Values

- A value is what the type of its column encodes, `null` for `NULL`, or an expression of the values of the column, whose node it keeps; a parameter is encoded by the type of its column without a cast, since the column types it, as for a compared value.
  Types take an expression of the output values of the column, so a column that is not nullable rejects an expression that may be `NULL`.
- A key of `undefined` is omitted, as a key that an object lacks, so that an optional property of TypeScript, which may hold `undefined` without `exactOptionalPropertyTypes`, omits its column.
- Mutations read the keys and values of their objects when they are called, and reject a key that is not a column.
- A value may be a query of one value, such as of `get`, of an aggregate, or of `exists`, which is a scalar subquery or `EXISTS` in `VALUES` or `SET`, as an operand of an expression is ([queries](queries.md#queries-in-expressions)), and other queries are rejected, in types and at runtime.
  - Types take it by its value in an expression or `NULL`, so a column that is not nullable takes a query that is `NULL` without its row, such as of `get`, unlike an expression that may be `NULL`: PostgreSQL rejects the statement without the row, which is how such a value requires it.
  - It adds about 3% to the instantiations of a query of `insert` and 1% to one of `update` of values ([benchmark](../benchmarks/types/queries.bench.ts)).
  - A query among the values of an insert or of an object of an update does not add its relations to the state of the mutation, as a condition does not, so only lowering rejects a relation that the `Db` lacks, at runtime.
- An insert may omit a column marked with `hasDefault` and a nullable column, which get their defaults, `NULL` for a nullable column without one; types require the other columns, and the database rejects a record that misses one.
  - The columns of the statement are those that some record gives a value other than `undefined`, in the order that the records first give them, and a record that lacks one inserts `DEFAULT`.
  - One record without values inserts `DEFAULT VALUES`, and several insert the `DEFAULT` of the first column of the table, since `DEFAULT VALUES` inserts one row.
  - The values of an insert see no source, so they cannot refer to a column.
  - `insertMany` rejects an array without records, which has no statement to compile.
- `update` takes the values of its columns or a callback that receives the columns and the relations of the changed rows and returns them, and rejects values without a column to set, which have no statement to compile.
  - A query of a relation among the values of the callback is correlated with the changed row.
    It reads the snapshot of the statement, so a relation of the table of the update reads the rows as they were before it, under an alias of its own.
  - The queries among the values of the callback add their relations to the state of the mutation, as the nested queries of a selection do, so types reject them where the `Db` lacks them; an expression, such as of `expr` or `coalesce`, does not carry them, and only lowering rejects them, at any depth of the statement ([queries of a Db](queries.md#queries-of-a-db)).
    The values of a callback annotated with `UpdateValues` may hold a query of any relation, as a `Selection` may, so types reject them on a `Db` of known relations.
  - `update` has an overload that infers the type of a callback for the relations of its values, and then one of a value of `UpdateSet`, which takes an object or a callback, so that a call that matches no overload reports the error of its own form and a value of `UpdateSet` applies, whose relations stay out of the state.
    One signature that infers the values of a callback takes about 10% more instantiations for a callback and 1% for an object ([benchmark](../benchmarks/types/queries.bench.ts)), and a variable of `UpdateSet` could not be passed to a signature of a callback and one of an object.
    The overload infers the callback rather than its values, so that the constraint of the callback types its body by the columns of the table: with a type parameter of the values, the body of the callback sees no specific table, which widens a literal of a column, such as of an enum, and a callback keeps that type for every overload.
    A conditional type of a callback that infers its values, as `where` takes its filter ([queries](queries.md)), takes about 5% to 15% more instantiations for each form of `update` ([benchmark](../benchmarks/types/queries.bench.ts)).

## Results

- A mutation resolves to the number of the rows it changes, which the command tag of its statement gives without `RETURNING`.
  - A mutation of rows `one`, such as of `find`, rejects with `NotFoundError` without a row, and one of rows `optional` or `nullable` resolves to `0`.
  - A mutation of one row rejects several rows, as a query of one row rejects them, such as of a database that lacks a key of its table or of `find` with an expression of a column, such as ``find(sql`id`)``.
  - Its state has `number` as the value of rows `one`, the rows mode of the changed rows as `changed`, and `returning: false`, so that `QueryResult` and the `then` of a query type its result.
- `select`, `get`, and `pluck` after a mutation return the fields of the changed rows instead, as `RETURNING`, in the rows mode of the changed rows: records of `select`, which adds fields as `select` of a query does, or values of `get` and `pluck`, which replace the fields.
  - Their callbacks receive the columns and the relations of the changed rows, and those of `get` and `pluck` return a value as those of a query do ([nested queries and relations](queries.md#nested-queries-and-relations)).
  - `get` applies only to a mutation of one row, and makes rows `nullable` `optional`, as for a query; `pluck` keeps the rows of a mutation of many rows.
  - `select` rejects a mutation of `get` or `pluck`, in types and at runtime, as for a query of values.
  - PostgreSQL rejects `RETURNING` without fields, so a mutation of `select` without fields resolves to as many records without fields as the command tag reports.
- An update returns the values of the rows after the update, and a delete the values of the deleted rows.
- `insertMany` does not promise the order of the rows it returns, so matching them to its records requires a key.
  PostgreSQL returns the rows of `INSERT ... VALUES` in the order of `VALUES`, but does not document it, and Tom Lane declined to guarantee it: "the current implementation happens to act like that, but there is no reason that we should make it guaranteed behavior" ([pgsql-hackers](https://www.postgresql.org/message-id/19445.1350482182%40sss.pgh.pa.us)).
  Django relies on it: `bulk_create` pairs the returned rows with its objects by position ([`django/db/models/query.py`](https://github.com/django/django/blob/main/django/db/models/query.py)).
- The fields of `RETURNING` may nest the rows of queries, such as of the relations of the changed rows, which lowering packs as scalar subqueries of `RETURNING`, as in a select list, so the mutation and the reads of its nested rows are one statement, atomic without a transaction or a savepoint of their own.
  Orchid ORM loads the relations that a mutation selects with a second query; for a mutation whose failure is caught, it left the savepoint across both open, and kept the changes of the mutation when an after hook between them threw ([orchid-orm#824](https://github.com/romeerez/orchid-orm/pull/824)).
  - The nested queries read the snapshot of the statement, as all parts of a statement do ([PostgreSQL](https://www.postgresql.org/docs/current/queries-with.html#QUERIES-WITH-MODIFYING)): the database before the mutation, apart from the columns of the changed row, which are its values after an insert or an update.
    So a nested query of the table of the mutation, such as of the form of a changed field after an update of forms, reads its records before the change.
- A mutation checks its rows and decodes its result after the statement, so its rejection there, such as with `NotFoundError` of a nested `find`, with several rows of a mutation of one row, or with a value that fails to decode, comes after the change and does not undo it.
  Undoing the change with the error requires a transaction around the mutation; kern-orm adds no transaction or savepoint of its own, which would cost two roundtrips for each mutation.
- A selection rejects a mutation as a field, in types and at runtime: PostgreSQL takes a data-modifying statement only in `WITH`.
- `map` and `transform` [convert the result in code](queries.md#converting-results) after these checks, and return a mutation, which stays no field of a selection and no operand of an expression.
  - `map` converts what the mutation returns, so it applies only to a mutation of a selection: types require `returning: true`, and it rejects at runtime a mutation that resolves to the number of the rows, whose `0` would read as a row to convert.
  - `transform` converts what the mutation resolves to, also the number of the rows, and `0` of a mutation of rows `optional` or `nullable` without its row.
  - `select`, `get`, and `pluck` reject a mutation that they convert, in types and at runtime, since their callbacks read what it returns; types tell it by the `value` part of the state, `"mapped"` of `map` and `"transformed"` of `transform`, which `map` also rejects.
    A failure of a callback comes after the change and does not undo it, as a failure of decoding does.

## Helpers

- `use` takes a callback or a helper of [`defineHelper`](queries.md#helpers), so that one helper that selects fields and maps them serves a query of a table and a mutation alike; the callback returns the mutation it receives or one derived from it, in types and at runtime, as `use` of a query does.
  - The callback of a helper receives the mutation at runtime, typed as a query of a table, so it may call only what both have: `select` and `map`, with the columns and the relations of the changed rows.
  - The effect of the helper tells whether it filters or takes one row, which types reject on a mutation, so that the error names what it can do; it does not tell `orderBy`, `limit`, `offset`, and `distinct`, which fail at runtime as a method the mutation lacks, as a helper of pagination fails on a query of one row.
  - Types also accept `map` without `select` in a helper, which rejects at runtime on a mutation without earlier fields, since the state does not keep the fields before `map`.
  - The effect does not tell a selection of no fields from no selection, so types keep the number of the rows, whereas that selection returns empty records; a selection that `use` adds to a mutation of the number of its rows must therefore have at least one field, also in a callback, which `use` does not tell from a helper, and `use` rejects it before the mutation runs.
  - The effect gives a mutation of the fields it selects or of what `map` gives, in the rows mode of the changed rows; a helper that does neither leaves the number of the rows.
  - A mutation applies a helper only with `use`, not as a function of a query: an overload of `Helper` for a mutation would make `use` of a query infer from its last overload only, whereas `use` of a mutation infers the parameters of `Helper` by its alias.
  - A callback of `use` comes first among the overloads, since TypeScript keeps the type that the first overload gives to the parameter of a callback.

## Statements

- A statement takes at most 65535 parameters, which the protocol of PostgreSQL counts in 16 bits; the compiler rejects a further parameter of any statement, so an insert of more values must be split into several statements, such as in a transaction.
  Orchid ORM splits such an insert into several statements in one savepoint, and a failure of a later one left the transaction aborted ([orchid-orm#811](https://github.com/romeerez/orchid-orm/pull/811)); kern-orm keeps one statement for one mutation.
