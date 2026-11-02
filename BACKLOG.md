# Backlog

Work not done yet, ideas, and research, in no order.

## Filtering by related records

Filtering records by their related records in `where`, such as the forms that have submissions or the submissions without comments, by `EXISTS` of a relation query.
Correlate each relation of a chain, such as of a through relation, with its own source ([orchid-orm#851](https://github.com/romeerez/orchid-orm/issues/851)).

## Aggregates of related records as expressions

An aggregate of related records, such as `form.fields.count()` or `form.fields.max("position")`, as an expression rather than a nested query, so that `orderBy` sorts by it through the selected fields.
Then `coalesce` could also be a function of expressions, beside the method of queries of values.

## Aggregates by the type of their argument

Research: types reject an aggregate whose argument PostgreSQL cannot aggregate, such as `sum` of `text`, so that completions of the argument offer only the columns it can.

- `min` and `max` of ordered types, as `orderingOperators` give them, except `uuid`, which has no `min` and `max` in PostgreSQL; `sum` and `avg` of numbers and `interval`, such as by a capability of numeric types that arithmetic operators would bring; `every` and `some` of `boolean`; `stringAgg` of text.
- Types could also tell the type of the value of an aggregate by the type of its argument, such as a number for the average of `bigint` values, which `avg` rejects: a property of a type that `transform` drops, carried by column references and expressions.
- Profile the cost of each aggregate call with `bench:types` before choosing a design.

## SQL nullability apart from the values of a type

Research: types tell whether a value can be `NULL` apart from the values of the type, as Orchid ORM does with the type of the database value, so that a type can decode `NULL` to a value, such as `false`, like [`parseNull`](https://orchid-orm.netlify.app/guide/common-column-methods#parsenull) of Orchid ORM 1.78, or a value to `null`, such as `""` of a `varchar` column that is not nullable or a JSON `null` value, and encode it back.

- Every reading of `null` among the values of a type as `NULL` moves to it: `coalesce`, object conditions, keys and `primaryKey`, the results of operators, and the value of an aggregate without rows.
- Encoding calls the type for `null` where the type maps it to a value.
- Queries take the values of a type, unlike those of Orchid ORM, which take the database values, so decide what `isNull` and an object condition of `null` mean for a type that decodes a value to `null`, and what `coalesce` and aggregates give for it.
- It adds a part to types and expressions, which every column reference and operator instantiates, so measure its cost with `bench:types` before choosing a design.

## `transform` and `map` of a query

`transform` and `map` of a query, as in Orchid ORM, such as `max("position").coalesce(0).transform(position => position + 1)`:

- `transform` converts the whole result of the query after decoding, executed or nested, including a missing row and the array of rows;
- `map` converts each record or value of the result and skips a missing row; decide whether it also skips a `NULL` value, such as of an aggregate without rows.
- They change the result in types but not the SQL, so decide which methods apply after them, such as `where` and `select`, and how `orderBy` of the selected fields, helpers, and the paths of decoding errors treat a converted value.

## Keyset pagination

Pages after the sort keys of the last row of the previous page, reading the order of a query, which its node keeps as expressions with directions; how code outside kern-orm reads the order is not designed.

## Scalar fragments of kern-orm in pages after an offset

A page after an offset keeps the nested queries on its table when a nested query holds a SQL fragment that refers to a column of the table, as [architecture/sql.md](architecture/sql.md#nested-rows) states, since a fragment may aggregate the rows of the query.
Fragments that kern-orm builds are known to be scalar, such as the `coalesce` of the fallbacks of an aggregate in `form.fields.max("id").coalesce(form.id)`, yet they keep the page on its table too.

- Mark such fragments, such as by a flag of a raw node or a node kind of a function call, so that the check skips them.
- Research first which fragments refer to the columns of a parent row: the fallbacks of aggregates, and possibly generic operators and the operators of custom types.

## SQL fragments of users in pages after an offset

Research and a decision: whether a SQL fragment of a user in a nested query can keep the nested queries of a page after an offset over the rows of the page, which kern-orm cannot tell from the text of the fragment, since a fragment may hold an aggregate of the rows of an enclosing query, such as a user-defined aggregate that only the catalog of the database knows.

- A contract that a fragment in a nested query never aggregates the rows of an enclosing query, for which the aggregate methods exist, would drop the check, but breaking it would change results silently rather than fail.
- A variant of `sql` for fragments that are known to be scalar would keep the check for other fragments, at the cost of a public API for a rare case.
- A fragment that does aggregate the parent rows makes the parent query return one row, so the nested queries run once anyway; only scalar fragments lose the speed-up.

## Through and many-to-many relations

## Several records of a relation `one`

To think about: an error that names the field when a relation `one` finds several records, such as where the database lacks a key that its table declares, instead of the SQLSTATE `21000` of PostgreSQL, such as by `LIMIT 2` and a check in decoding; measure its cost first.

## `$select` as a field of a selection

A query of `$select` as a field of a selection, such as of `select` or of another `$select`, nested as the rows of a query of a table are: packing reads a statement without a source through a derived source like any other, so it needs `RecordQuery` among the nested queries of a selection and its node in the nested selection node.

## Sorting by a field of a related record

Sorting by a field of the related record of a relation `one`, such as fields by the name of their form; keep the design of sorting and relations open to it.
The answers of a submission in the order of their fields need it too: `getSubmissionReview` of `examples/forms` selects the fields of the form in their order with the answer of each instead.

## Records of a relation at any depth

Records of a relation of a table to itself at any depth through `WITH RECURSIVE`, such as the fields shown after a field directly or through others, or the ancestors of a category; nested queries of a relation reach only the depth that a query spells out.

## Helper effects of their calls

Helper effects that record the calls of their callbacks rather than only the rows mode they end with, so that types check what the runtime checks and the limitations that [architecture/queries.md](architecture/queries.md#helpers) states for helpers go away:

- a query of one row rejects a helper that calls `limit` or `offset`;
- the effect applies the calls that change the rows in their order, also in a helper that it applies, so that a helper whose last such call is `required` makes a query of one row `one` in types, as it does at runtime;
- a query of values rejects a helper that calls `nullable` before `optional` or `required`, also when the call is in a helper that it applies.

It needs a new part of the query state, so measure its cost with `bench:types` before choosing a design.

## Scopes

Predicates that a table applies to its queries, such as excluding soft-deleted records, kept as the `scope` filters of a query, as the [decisions on queries](architecture/queries.md#decisions) state.
Test that a scope predicate is never an operand of a user `OR` ([orchid-orm#845](https://github.com/romeerez/orchid-orm/issues/845)).

## Relation-aware mutations

A separate project.

## Bulk inserts beyond the parameter limit

A helper or an opt-in option of a query for inserts of more values than the 65535 parameters of a statement, such as tens of thousands of records, which `insertMany` rejects, as [architecture/mutations.md](architecture/mutations.md#statements) states.

- Records of the same columns of plain values could be sent as one array parameter of the text representations of each column, `INSERT ... SELECT ... FROM unnest($1::text[], $2::text[])` cast to the types of the columns, whose text does not depend on the number of the records; records that omit a column for its `DEFAULT` or give an expression need `VALUES`.
- Alternatively, the helper splits the records into statements in a transaction of its own; then a later statement sees the rows of an earlier one, unlike one statement.
  Orchid ORM splits such an insert by itself, and a failure of a later statement left the transaction aborted ([orchid-orm#811](https://github.com/romeerez/orchid-orm/pull/811)).
- Benchmark the variants against `VALUES` for small and large numbers of records before choosing.

## Empty changes and `none()`

An `update` without values and an `insertMany` without records reject, as [architecture/mutations.md](architecture/mutations.md#values) states.
Two independent goals:

1. Take them as changing nothing, so that code that passes the values of a request, such as of a PATCH, needs no check such as `if (Object.keys(values).length > 0)` before `update`.
   - An `update` without values changes no row, and with selected fields selects them from the rows it would change, so that a query of `find` still checks its record.
     Orchid ORM 1.78.47 turns it into a select of the rows, `SELECT count(*)` without selected fields ([docs](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/update.md#empty-set)).
   - An `insertMany` without records changes no row: the number `0`, or an empty array of the selected fields.
   - Decide what an `update` without values and without selected fields resolves to, such as `0` without a statement, and whether a query of `find` then checks its record.
2. Skip the statement when its result is known without the database: a query of `none()`, a filter of `FALSE`, such as of `in([])`, or an `insertMany` without records resolves to no rows without a roundtrip.
   - Decide what `toSQL` and `$compile` give for a query without a statement.

## Queries as values of inserts and updates

Orchid ORM 1.78.47 takes a query of one value as the value of a column, such as `() => db.other.find(id).get("name")` ([docs](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/create.md#sub-queries)), and inserts the records of a query with `createOneFrom` and `createForEachFrom` (`INSERT ... SELECT`, [docs](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/create.md#createonefrom-insertfrom)); kern-orm takes values and expressions only, and rejects a query as a value.

## Values before an update

PostgreSQL 18 lets `RETURNING` read a changed row before and after the change as `old` and `new`, such as `RETURNING old.published, new.published`; the fields selected after `update` give only the values after it.

- Decide how the callback of `select` after `update` refers to the values before it, such as by a second argument of the columns of the row before the update.
- Decide whether `insert` takes them, where `old` is `NULL` without an upsert conflict, and `delete`, where `new` is `NULL`.
- PostgreSQL before 18 rejects `old` and `new` in `RETURNING`.

## Runtime defaults of columns

A column can declare a default that kern-orm gives an insert that omits the column: `.default(value)`, or `.default(() => value)`, called for each inserted record, such as `t.uuid.primaryKey().default(() => randomUUID())`.
`hasDefault()` stays the mark of a default of the database.

- An insert may omit a column with a runtime default, as one marked with `hasDefault`.
- Decide whether a default can be an expression, such as a `sql` fragment.
- Orchid ORM 1.78.47 takes a value or a `sql` fragment of `.default` as a default of the database, which its migrations declare, and only a callback as a default at runtime ([docs](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/common-column-methods.md#default)); in kern-orm, a value of `.default` is a runtime default as well.

## Generated columns

Columns that the database computes, such as `GENERATED ALWAYS AS (...) STORED`, which inserts and updates must not set; `hasDefault` lets inserts omit them but still takes values for them.

## Upsert

An insert that updates or skips the record it conflicts with on a key, as `INSERT ... ON CONFLICT ... DO UPDATE` or `DO NOTHING`, such as the row of a singleton table that the [motivation](architecture/README.md#motivation) names.

- Upserts take their conflict target from the keys of the table.
- Decide how the values of the update refer to the values of the insert, `EXCLUDED` of PostgreSQL, such as by an argument of the callback of the update values.
- `DO NOTHING` returns no row for a record that conflicts, so decide the rows mode of the fields that it selects, such as `optional` for one record.
- PostgreSQL rejects `DO UPDATE` of a statement whose records conflict with the same row twice, such as an `insertMany` of two records of one key, with SQLSTATE `21000`.

## Row locks

Locking the rows that a query reads, as `SELECT ... FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE`, or `FOR KEY SHARE`, with `NOWAIT` or `SKIP LOCKED`, such as for a queue of jobs.

- PostgreSQL rejects a locking clause in a query of aggregates, `DISTINCT`, or `GROUP BY`, so reject it in a query of an aggregate method.
- The clause locks the rows of the tables in `FROM` of its query, including those of a derived source, but not the related records of nested queries in the select list; decide whether nested queries can lock their own rows, and whether lowering keeps the clause when it packs the query into a derived source, such as a page after an offset.
- Outside a transaction the lock ends with its statement, so decide whether a locking query rejects outside one.

## Union of queries of several tables

Optional, research: a function that types a union of queries of several tables or kinds, such as `cond ? db.foo : db.bar`, as one query whose overloaded methods TypeScript can call, while a query of one table keeps its plain types.

- At runtime it returns its argument: methods resolve columns by name in the table of the chosen query.
- Its table has the columns that every table has with the same type; a column of the same name and another type, a filter of `defineFilter`, and a relation of one table are unavailable.
- Its result and rows mode are the unions of those of the queries, and its kind is bound or unbound when every query is, and either kind otherwise.
- The state keeps the source tables as a new part, so that a `Db` still checks them against its schema.
- Check first whether a union of tables in the state, `SelectQuery<InitialQueryState<typeof foo | typeof bar>, Kind>`, already gives the common columns.
- Branches of a callback of `use` or of a helper that leave different states could become one query of a union state the same way.
- Alternatively, methods that change the state could apply to a union of queries by one of the designs that [architecture/queries.md](architecture/queries.md) weighs, at the costs it records.

## Statement timeout of test transactions

An opt-in option of `createTestHelpers`, such as `statementTimeout` and `lockTimeout`, that sets `statement_timeout` and `lock_timeout` locally in every test level, pipelined with its `BEGIN` or `SAVEPOINT`, so that a statement already sent by an aborted or preempted test delays the next test for a bounded time.

- The seeds of test fixtures, such as long migrations, run without them, since the rollback of a test level resets its local settings.
- Build it on the settings of a level, a [decision on transactions](architecture/transactions.md#decisions), rather than as a separate mechanism.
- Keep it opt-in: kern-orm does not know the timeouts of the test runner, and a limit that users did not set would fail slow tests whose code passes in production.
- Orchid ORM bounds the wait in the teardown instead, with `teardownTimeout` of `testTransaction.hooks`, and blocks its adapter once it is exceeded ([orchid-orm#818](https://github.com/romeerez/orchid-orm/pull/818)).

## Migrations

The package `@kern-orm/migrations`, as [architecture/migrations.md](architecture/migrations.md) decides:

- settings of a transaction level, starting with the search path, restored when a nested level ends;
- the package with the migration format, histories, applying and rolling back, and the helpers;
- the command line;
- the verification of histories and migration tests.

## Comparison with other ORMs

A "Why kern-orm" section of the README and a page of the site that compare kern-orm with other ORMs and query builders, such as Drizzle ORM, Kysely, Prisma, and Orchid ORM, in the scenarios where it differs: related records in one statement, ambient transactions, tables and queries reused across PostgreSQL schemas, and tests in transactions that roll back.

- Collect the differences from the records of other ORMs in tests, [architecture/](architecture/README.md), and this backlog.
- State each behavior of another ORM only as checked in its documentation, issues, or a named version, with a link.
