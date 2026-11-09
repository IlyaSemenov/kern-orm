# Backlog

Work not done yet, ideas, and research, roughly from the most important; the order is a loose hint, not a plan.

## Moving from rake-db

Moving a project from rake-db to `@kern-orm/migrations`:

- Decide whether the migrator imports the applied versions of a rake-db table, of `version` and `name`, once, or projects convert them.
- Decide how a history whose earlier migrations a baseline of the schema replaces marks the baseline applied on existing targets.

## Migrations outside a transaction

Migrations that PostgreSQL rejects in a transaction block, such as of `CREATE INDEX CONCURRENTLY`, while `@kern-orm/migrations` applies the pending migrations of a target in one transaction.

## Irreversible migrations in verification

A migration whose `down` cannot restore the structure, such as one that adds a value to an enum type, since PostgreSQL cannot remove a value of an enum, fails `verifyMigrations`.

- Preliminary decision: an option of `verifyMigrations` lists the keys of such migrations, which it applies without running their `down`, running `setup`, `up`, and `assertUp` of their migration tests.
- Decide what `rollback` and `redo` do with such a migration, such as reject before they change anything.

## Through and many-to-many relations

Relations through other relations, such as the answers of a form through its fields, and many-to-many relations through a join table, which queries select and filter by as other relations, as `chain` of Orchid ORM 1.78.47 queries the related records of related records ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/relation-queries.md#chain)).

- `EXISTS` of a chain correlates each relation with its own source; Orchid ORM joined the chained table to the outer one by the columns of the chained relation ([orchid-orm#851](https://github.com/romeerez/orchid-orm/issues/851)).
- Decide whether `$relations` declares a through relation, a query of a relation chains another relation, or both.

## Upsert

What [`upsert`](architecture/mutations.md#upserts) and [`onConflict`](architecture/mutations.md#conflicts) of an insert do not cover:

- Telling an inserted row from an updated one, which `old` of [values before an update](#values-before-an-update) gives on PostgreSQL 18.
- A partial unique index as the conflict target, such as of the records that are not soft-deleted, whose predicate `ON CONFLICT` requires, as the SQL target of `onConflict` of Orchid ORM does ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/create.md#onconflict)).
- A condition of the update, `DO UPDATE ... WHERE`, which makes rows `optional`; decide whether `where` before `upsert`, which `upsert` rejects, becomes it.

## Scopes and soft delete

Predicates that a table applies to its queries, such as excluding soft-deleted records, kept as the `scope` filters of a query, like `scopes` of Orchid ORM 1.78.47 ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/scopes.md)).

- Scope predicates are never operands of a user `OR`; test it ([orchid-orm#845](https://github.com/romeerez/orchid-orm/issues/845)).
- A scope that may exclude records ends the guarantee of the row as a filter does, so a query of a required relation to a table with such a scope starts with rows `nullable`.
- A scope applies to every query of its table, including queries of relations to it, nested queries, and queries of expressions, unless a query leaves it out by name, as `unscope` of Orchid ORM, such as to list deleted records.
- Decide whether a table or a schema declares scopes, as a schema declares relations.
- Soft delete builds on a scope: `delete` of a table with soft delete sets its column, such as `deletedAt` to `now()`, instead of deleting the rows, and a hard delete deletes them, as `softDelete`, `includeDeleted`, and `hardDelete` of Orchid ORM 1.78.47 ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/soft-delete.md)).
- A scope predicate does not restrict the rows of `update` and `delete`, which reject without another filter unless `all` allows it, as [architecture/mutations.md](architecture/mutations.md#rows-to-change) requires and as Orchid ORM does for soft delete.
- A table interpolated into `sql` is its name, which no scope filters.
- Decide whether `upsert` of a table with a scope updates a record that the scope excludes, such as a soft-deleted one, which `ON CONFLICT` finds whatever the filters of the query.

## Inserting the records of a query

Inserting the records that a query selects, as `INSERT ... SELECT`.
Orchid ORM 1.78.47 inserts them with `createOneFrom` and `createForEachFrom` ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/create.md#createonefrom-insertfrom)).

## Empty changes and `none()`

An `update` without values, an `upsert` without values, and an `insertMany` without records reject, as [values](architecture/mutations.md#values) and [upserts](architecture/mutations.md#upserts) of architecture/mutations.md state.
Two independent goals:

1. Take them as changing nothing, so that code that passes the values of a request, such as of a PATCH, needs no check such as `if (Object.keys(values).length > 0)` before `update`.
   - An `update` without values changes no row, and with selected fields selects them from the rows it would change, so that a query of `find` still checks its record.
     Orchid ORM 1.78.47 turns it into a select of the rows, `SELECT count(*)` without selected fields ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/update.md#empty-set)).
   - An `upsert` without values, such as of the empty values of a PATCH, changes no value of an existing record: after it, the record of the key exists and is returned, and a missing record is inserted with its defaults.
     - An update of the key, `ON CONFLICT (key) DO UPDATE SET <column of the key> = EXCLUDED.<column of the key>`, returns the record atomically in every case, but updates an existing row physically: it fires `UPDATE` triggers, such as of `updated_at`, locks the row, and writes a new version of it.
       The upsert of the row of a [singleton table](architecture/queries.md#queries-of-a-singleton-table) has no column of a key to set this way.
     - A select after `DO NOTHING`, `WITH inserted AS (INSERT ... ON CONFLICT DO NOTHING RETURNING ...) SELECT ... FROM inserted UNION ALL SELECT ... FROM <table> WHERE <key> AND NOT EXISTS (SELECT FROM inserted)`, leaves an existing row untouched, but its `SELECT` misses a record that a concurrent transaction inserted after the statement started, so it returns no row and rejects with `NotFoundError`.
     - Orchid ORM 1.78.47 turns `upsert` without the values of the update into `orCreate`: a `SELECT`, and then an `INSERT ... WHERE NOT EXISTS` in a second statement, which rejects with a unique violation when a concurrent transaction inserts the record between them ([source](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/packages/pqb/src/query/basic-features/mutate/upsert.ts#L47-L66)).
   - An `insertMany` without records changes no row: the number `0`, or an empty array of the selected fields.
   - Decide what an `update` or an `upsert` without values and without selected fields resolves to, such as `0` without a statement, whereas a mutation of rows `one` rejects with `NotFoundError` without a row, and whether a query of `find` then checks its record.
2. Skip the statement when its result is known without the database: a query of `none()`, a filter of `FALSE`, such as of `in([])`, or an `insertMany` without records resolves to no rows without a roundtrip.
   - Orchid ORM 1.78.47 resolves a query of `whereIn` of an empty list without querying the database ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/where.md#wherein)), and code that filters by a list from a request relies on it.
   - Decide what `toSQL` and `$compile` give for a query without a statement.

## Queries repeated in a statement

An expression that holds a query is not one expression for PostgreSQL at two places of a statement, since the compiler gives each occurrence of a source its own alias: a key of a [query of groups](architecture/queries.md#groups) that holds a query fails with `subquery uses ungrouped column` in `HAVING`, also beside an aggregate under `OR`, which `where` cannot replace, and in `ORDER BY` when the query does not select it, so only the position of its projection refers to it.

- A key and a sort key of a field that a later selection replaces, which hold a query, are lowered apart, so the key does not find the projection of the sort key; lowering one expression node to one node per query would give them one projection.
- A position refers to the selected projection, which `findValueProjection` finds by the same expression node or the same column.

## Parameters of keys without `param`

A key of a [query of groups](architecture/queries.md#groups) with a value interpolated into it, such as ``sql(t.date)`(${submission.createdAt} at time zone ${timeZone})::date``, fails in `HAVING` also when the condition reads it through its selected field, since the compiler binds only the parameter of `param(type, value)` once in a query of groups, so the copy of the key there has a parameter of its own.
Users must create the parameters of such a key with `param`, as [the grouping guide](docs/queries/grouping.md#keys-of-expressions) explains, while the same value without it needs no type anywhere else.

- Preliminary decision: bind every parameter node once in a query of groups, so that copies of one expression node, such as a field read in `having` or a sort key built from the same expression, compile to equal text; the lookup then costs only statements of groups.
- Check with PostgreSQL that it takes a repeated parameter without a type in `HAVING` and `ORDER BY` for the key of `GROUP BY`, such as of `AT TIME ZONE $1`.
- Decide what happens to a parameter node reused by one expression in contexts that infer different types, such as an untyped expression compared with an `integer` and with a `text` column, for which PostgreSQL deduces one type of the parameter; the compiler binds a parameter without a type apart at each place for this reason.

## Queries in aggregates of first rows

An aggregate method of a query of [`distinctOn`](architecture/queries.md#first-row-of-each-group) whose argument holds a query, such as the sum of the numbers of the fields of the latest version of each form, evaluates the query for every row that `DISTINCT ON` reads, since its derived source selects the argument.

- A source of the first rows that selects the columns that the argument reads and replaces the table, as `lowerPage` does, would let the aggregate evaluate the argument only over the first rows.
- An argument that may aggregate the rows, such as an aggregate function of a query of groups or a SQL fragment of the columns, must stay in the source, as `mayAggregateSource` tells for a page.

## First rows in another order

Rows of [`distinctOn`](architecture/queries.md#first-row-of-each-group) in an order that does not start with its keys, such as the latest submission of each user, newest first, which lowering rejects, since PostgreSQL requires the order of `DISTINCT ON` to start with its keys.

- A derived source of the first rows, sorted by the keys and then by the order of the query, read in the order of the query with its limit and offset, gives them; an order that starts with the keys keeps one statement.
- It only turns orders that lowering rejects into valid ones, so no query that runs changes.

## Other options of aggregate functions

Options of the [aggregate functions](architecture/types.md#aggregate-functions) beside `filter` and the `orderBy` of `stringAgg`, which SQL fragments cover until then: `distinct` of any aggregate, ordered-set aggregates as `WITHIN GROUP`, and window functions as `OVER`.
Orchid ORM 1.78.47 takes `distinct`, `order`, `filter`, `filterOr`, `withinGroup`, and `over` ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/aggregate.md)).

## Arithmetic operators

Operators of numeric expressions, such as `+` and `-`, and the increment of a column, such as of the number of comments of a record, which an update writes as ``sql(t.integer)`${record.commentsCount} + 1` ``, as `increment` and `decrement` of Orchid ORM 1.78.47 ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/update.md#increment)).

- They are a capability of numeric types, which [aggregates by the type of their argument](#aggregates-by-the-type-of-their-argument) would read too.
- Decide the type of the result of operands of different types, such as `integer` and `bigint`, and of dates and intervals.
- They add to the operators of every numeric column reference, so measure their cost with `bench:types`.

## JSON operators

Operators of `json` and `jsonb` expressions typed by the shape of `of<T>()`, such as `->` and `->>` of a key, to filter by a property, such as `config->>'fieldType' = 'rate'`, and functions of JSON paths, such as `jsonb_path_query_first`, as Orchid ORM 1.78.47 has them ([operators](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/where.md#jsonb-column-operators), [functions](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/json.md)).

- Decide the type of `->>` of a property that is not a string, which PostgreSQL gives as text.
- A missing property is `NULL` whatever the shape, which kern-orm does not validate, so decide whether an expression of a required property is nullable.

## Computed columns

Columns that a table defines as expressions over its other columns, which queries select, filter, and sort by their keys, such as the kind of an event that a key of its JSON details holds, and fields computed at runtime from selected columns, as `computed` and `computeAtRuntime` of Orchid ORM 1.78.47 ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/computed-columns.md)).

- Decide whether a table or a schema defines them, so that they can read relations, as a schema defines relations, such as the profit of a record from its related records.
- Inserts and updates reject them, as [generated columns](#generated-columns); decide whether `select("*")` selects them.
- Fields computed at runtime could be [`map`](architecture/queries.md#converting-results) of a query instead.

## Updating records with values of each

An update of several records, each with its own values, such as the positions and titles of the fields of a form from a request, in one statement, `UPDATE ... FROM (VALUES ...)` matched by a key, with the values encoded by the types of their columns rather than SQL types written by hand, as `updateMany` and `updateManyBy` of Orchid ORM 1.78.47 ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/update.md#updatemany)).

- The parameters of `VALUES` have no column to type them, so the statement casts them to the cast types of their columns, as `param` with a type does.
- Arrays of the values of each column, `unnest($1::uuid[], $2::text[])`, would keep the text of the statement the same for any number of records and their parameters within the limit, as [bulk inserts beyond the parameter limit](#bulk-inserts-beyond-the-parameter-limit) weighs for inserts.
- Decide whether a record without a row rejects, as a query of `find` does, and whether records may set different columns.

## After-commit hooks

Callbacks that run after the current transaction commits, such as sending the notifications of the changes it made, as `$afterCommit` of Orchid ORM 1.78.47 does ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/transactions.md#aftercommit)).
A hook belongs to the level that registers it: rolling the level back discards it, releasing the level passes it to the enclosing level, and it runs after the outermost commit, so that it runs only for the work that the commit keeps, whichever `Db` of the database registers it, as the [motivation](architecture/README.md#motivation) requires.

- Decide what a hook registered outside a transaction does; Orchid ORM runs it on the next microtask.
- Decide how a failure of a hook is reported once the transaction has committed; Orchid ORM leaves it to `uncaughtException` or `unhandledRejection`.
- The outermost transaction of code under test is a nested level of the test level, which never commits: decide whether its hooks run when it is released, as in production, and whether the rollback of the test level waits for them, as in Orchid ORM ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/transactions.md#after-commit-hooks-in-tests), [orchid-orm#822](https://github.com/romeerez/orchid-orm/pull/822)), so that their queries roll back with the test.
  A test level does not count as a transaction for [joining](architecture/transactions.md#joining).

## Connection loss in transactions

A transaction whose connection is lost rejects with the errors of its statements: a `ConnectionError` of `BEGIN` or `COMMIT`, or a `SuppressedError` of "Transaction rollback failed" whose `error` is the `ConnectionError` of the rollback after a statement of the callback lost the connection.
The message suggests that the rollback left the transaction open, while the server rolls back a transaction whose connection goes away, and telling whether the transaction may have been committed takes knowing which statement failed.

- Decide on an error that tells the phase of the loss: `begin`, where nothing was applied; `transaction`, where the server rolls back the transaction; and `commit`, where the outcome is unknown, since the server may have applied `COMMIT` before the connection broke.
- kern-jobs could then run its transactions with `transaction` of a `Database` instead of its own `transaction.ts`, which tells these phases by the classes of the errors of the driver.

## Columns of a violated unique constraint

The keys of the columns of a violated unique constraint, such as to tell users which field is taken without naming the constraint.
Orchid ORM 1.78.47 gives them as `columns` of its `QueryError`, which it reads from `detail` of the error and maps to the keys of the table ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/error-handling.md#database-error)).

- A driver creates `QueryError` without the query, so the keys need the query that PostgreSQL rejected, such as at its `await`.
- Decide whether to read the columns from `detail`, which PostgreSQL translates by `lc_messages`, or from the catalog by `constraint`.

## Type of the fields of a helper

A type of the fields that a helper selects, such as of the records that a function returns from a query of the helper: `ResultOf` takes a query, while the fields are `E["fields"]` of `Helper<T, E, A>`, which `infer` reads from `typeof helper`.
Decide between `ResultOf` of a helper and a type of its own.

## Non-waiting advisory locks and integer keys

A variant of [`$lock`](architecture/transactions.md#locks) that returns whether it took the lock instead of waiting, `pg_try_advisory_xact_lock`, such as for a job that only one process runs and others skip, and integer keys of PostgreSQL beside string keys, such as to share locks with code outside kern-orm.

## Migrating every tenant

A command of the migration command line for every schema of a target whose PostgreSQL schema is a function, such as all tenants, from a list of schemas that the project gives.

## Runtime defaults of columns

A column can declare a default that kern-orm gives an insert that omits the column: `.default(value)`, or `.default(() => value)`, called for each inserted record, such as `t.uuid.primaryKey().default(() => randomUUID())`.
`hasDefault()` stays the mark of a default of the database.

- An insert may omit a column with a runtime default, as one marked with `hasDefault`.
- Decide whether a default can be an expression, such as a `sql` fragment.
- Orchid ORM 1.78.47 takes a value or a `sql` fragment of `.default` as a default of the database, which its migrations declare, and only a callback as a default at runtime ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/common-column-methods.md#default)); in kern-orm, a value of `.default` is a runtime default as well.

## Generated columns

Columns that the database computes, such as `GENERATED ALWAYS AS (...) STORED`, which inserts and updates must not set; `hasDefault` lets inserts omit them but still takes values for them.

## Bulk inserts beyond the parameter limit

A helper or an opt-in option of a query for inserts of more values than the 65535 parameters of a statement, such as tens of thousands of records, which `insertMany` rejects, as [architecture/mutations.md](architecture/mutations.md#statements) states.

- Records of the same columns of plain values could be sent as one array parameter of the text representations of each column, `INSERT ... SELECT ... FROM unnest($1::text[], $2::text[])` cast to the types of the columns, whose text does not depend on the number of the records; records that omit a column for its `DEFAULT` or give an expression need `VALUES`.
- Alternatively, the helper splits the records into statements in a transaction of its own; then a later statement sees the rows of an earlier one, unlike one statement.
  Orchid ORM splits such an insert by itself, and a failure of a later statement left the transaction aborted ([orchid-orm#811](https://github.com/romeerez/orchid-orm/pull/811)).
- Benchmark the variants against `VALUES` for small and large numbers of records before choosing.

## Comparison with other projects

A "Why kern-orm" section of the README and a page of the site that compare kern-orm with other ORMs and query builders, such as Drizzle ORM, Kysely, Prisma, and Orchid ORM, in the scenarios of [comparison/](comparison/README.md) where it differs.

## Keyset pagination

Pages after the sort keys of the last row of the previous page, reading the order of a query, which its node keeps as expressions with directions; how code outside kern-orm reads the order is not designed.

## Helpers of a mutation in types

[`use` of a mutation](architecture/mutations.md#helpers) rejects at runtime some of what types accept, and a helper applies to a mutation only with `use`, not as a function of a query:

- Types accept a helper that calls `groupBy`, `orderBy`, `limit`, or `offset`, which a mutation lacks; the effect records only guaranteed grouping, which `use` of a mutation does not check.
- Types do not tell a selection of no fields from none, which needs a new part of the state or of the marker of a helper, and each query would pay for it.

## Index in the callback of `map`

The callback of `map` takes only the record or the value; it should take the arguments of `Array.map`, with the index, as in Orchid ORM ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/query-methods.md#map)).

A query of one row passes the index 0, such as `take` after a helper that maps the records.

## `map` only of records

`map` converts the records of a query, but also applies to a query of values, such as of `get`, `pluck`, or an aggregate method, where it has no records to convert; it should reject a query of one value, whose value `transform` converts.

- Decide whether it rejects a query of `pluck` too.

## `transform` and `map` beyond their current limits

[`transform` and `map`](architecture/queries.md#converting-results) leave out what no use has needed yet:

- A query of `$select` and a query of SQL text have no such methods, such as to define one unbound `$select` that gives a converted value; a bound one can convert its result after `await`.
- `count`, `exists`, `get`, and `pluck` reject a query of `map`, though they replace the fields that its callback reads, so they could drop the conversion, such as to count the rows of a query that a helper of `map` defines.
- The callback of `orderBy` after `map` has no selected fields, and could read those that `map` receives, which the state would need to keep.
- `where`, `orderBy`, `limit`, and `offset` could apply after `transform` where they keep what its callback receives, such as on a query whose row no relation guarantees.
- Types accept `map` without `select` in a helper, which [`use` of a mutation](architecture/mutations.md#helpers) rejects at runtime on a mutation without earlier selected fields, since the state does not keep the fields before `map`.

## Records of a relation at any depth

Records of a relation of a table to itself at any depth through `WITH RECURSIVE`, such as the fields shown after a field directly or through others, or the ancestors of a category; nested queries of a relation reach only the depth that a query spells out.

## Unions and common table expressions

`UNION ALL` of queries, `WITH` queries, and queries of a derived source of another query, such as the nearest administrators of a record among those of its ancestors.
[Records of a relation at any depth](#records-of-a-relation-at-any-depth) need `WITH RECURSIVE` too.
A query of `WITH` that locks the rows that the rest of a statement changes, such as `WITH locked AS (SELECT ... FOR UPDATE) UPDATE ...`, is written as SQL text with the query interpolated until then.
[Groups](architecture/queries.md#groups) of the rows of a union of queries need it too.

## Joins

Queries with joined tables:

- Decide which sources the column values of `where` resolve against, whether they can address joined tables, and how a callback receives the columns of joined tables.
- `SelectQuery` is typed by a single table and will need the shape of all query sources.
- A column of a source joined with `LEFT JOIN` is `NULL` without a match whatever its type, so its result type needs the nullability of the join.
- A [row lock](architecture/queries.md#row-locks) of a query with joins applies to all its sources, and PostgreSQL rejects it for the nullable side of an outer join, so it will need the sources to lock, as `FOR UPDATE OF`.
- Sorting by a field of a related record, such as fields by the name of their form, is a [scalar subquery](architecture/queries.md#sorting-and-pagination) of the relation in `orderBy`; benchmark a join against it, such as with an index of the order.
- A [query of groups](architecture/queries.md#groups) as a joined source, such as of the rows with the largest sums.

## Values before an update

PostgreSQL 18 lets `RETURNING` read a changed row before and after the change as `old` and `new`, such as `RETURNING old.published, new.published`; the fields selected after `update` give only the values after it.

- Decide how the callback of `select` after `update` refers to the values before it, such as by a second argument of the columns of the row before the update.
- Decide whether `insert` takes them, where `old` is `NULL` without an upsert conflict, and `delete`, where `new` is `NULL`.
- PostgreSQL before 18 rejects `old` and `new` in `RETURNING`.

## Statement timeout of test transactions

An opt-in option of `createTestHelpers`, such as `statementTimeout` and `lockTimeout`, that sets `statement_timeout` and `lock_timeout` locally in every test level, pipelined with its `BEGIN` or `SAVEPOINT`, so that a statement already sent by an aborted or preempted test delays the next test for a bounded time.

- The seeds of test fixtures, such as long migrations, run without them, since the rollback of a test level resets its local settings.
- Build it on the [settings of a level](architecture/transactions.md#settings) rather than as a separate mechanism.
- Keep it opt-in: kern-orm does not know the timeouts of the test runner, and a limit that users did not set would fail slow tests whose code passes in production.
- Orchid ORM bounds the wait in the teardown instead, with `teardownTimeout` of `testTransaction.hooks`, and blocks its adapter once it is exceeded ([orchid-orm#818](https://github.com/romeerez/orchid-orm/pull/818)).

## pgvector type

A type of `vector` of pgvector, as a built-in type or a package of types, whose values are arrays of numbers, with the operators of its distances, such as `<=>` for sorting by similarity; [custom types](docs/custom-types.md#type-parameters) define its values in an example.

## Helper effects of their calls

Helper effects that record the calls of their callbacks rather than only the rows mode they end with, so that types check what the runtime checks and the limitations that [architecture/queries.md](architecture/queries.md#helpers) states for helpers go away:

- a query of one row rejects a helper that calls `limit` or `offset`;
- the effect applies the calls that change the rows in their order, also in a helper that it applies, so that a helper whose last such call is `required` makes a query of one row `one` in types, as it does at runtime;
- a query of values rejects a helper that calls `nullable` before `optional` or `required`, also when the call is in a helper that it applies;
- a query with a row lock rejects a helper that calls `groupBy`;
- a conditional call of `groupBy` is recorded even when TypeScript reduces the union of its branches to the ungrouped one, so queries made by an aggregate, `exists`, or `map` reject it too.

It needs a new part of the query state, so measure its cost with `bench:types` before choosing a design.

## Relations of conditions in types

Research whether types should check the relations that the queries of a condition read, such as `survey.questions` in `where(survey => survey.questions.exists())`, and decide whether to check them at all: lowering rejects a relation that the `Db` lacks at runtime ([architecture/queries.md](architecture/queries.md#queries-of-a-db)), and the cost in types may outweigh the cases it catches.
A condition carries no relations in types, unlike a selection, which carries them in `uses`, so types accept:

- a helper of a schema whose callback filters by a relation, such as `defineHelper(schema.survey, query => query.where(survey => survey.questions.exists()))`, on a query without the relation, such as `from(survey)`, where the callback fails to read the relation, while types reject a helper that selects the relation there ([architecture/queries.md](architecture/queries.md#helpers));
- a query of a `Db` whose condition reads a relation that the relations of the `Db` lack, which only lowering rejects;
- a selected expression of a query of a relation, such as `form.fields.count().expr()`, in both of these ways, unlike the same query selected as it is;
- a key of `groupBy` and a condition of `having` that read a relation, such as `groupBy(form => form.fields.count())`, in the same ways, since `groupBy` and `having` keep `uses`.

Checking them needs the relations in the types of expressions and conditions, so measure its cost with `bench:types` before choosing a design.

## Aggregates by the type of their argument

Research: types reject an aggregate whose argument PostgreSQL cannot aggregate, such as `sum` of `text`, so that completions of the argument offer only the columns it can.

- `min` and `max` of ordered types, as `orderingOperators` give them, except `uuid`, which has no `min` and `max` in PostgreSQL; `sum` and `avg` of numbers and `interval`, such as by a capability of numeric types that arithmetic operators would bring; `every` and `some` of `boolean`; `stringAgg` of text.
- Types could also tell the type of the value of an aggregate by the type of its argument, such as a number for the average of `bigint` values, which `avg` rejects: a property of a type that `transform` drops, carried by column references and expressions.
- The [aggregate functions](architecture/types.md#aggregate-functions) take the same argument, so the design applies to both.
- Profile the cost of each aggregate call with `bench:types` before choosing a design.

## Decoding `NULL` to a value

A type that decodes `NULL` to a value, such as `false`, or `undefined` that tells it from a JSON `null` value, like [`parseNull`](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/common-column-methods.md#parsenull) of Orchid ORM 1.78, and passes the value as `NULL`, or that decodes a value to `null`, such as `""` of a `varchar` column that is not nullable.

- Replace the recipe of [JSON `null` values](docs/types.md#json-null-values), a sentinel of a JSON `null` value and `map`, with native support, and remove the recipe: projects need to read `NULL` of a `jsonb` column as `undefined` and a JSON `null` value as `null`.
- Preliminary decision: the type maps `NULL` and the value both ways: a result decodes `NULL` to the value, a query passes the value as `NULL`, and an object condition of the value is `IS NULL`, while `null` is a value of the type like any other, such as a JSON `null` value of `jsonb`.
  - An insert omits `undefined` and an update keeps it, so a query cannot pass `undefined` as `NULL`: decide what passes `NULL` for a type that decodes it to `undefined`, such as `null` as in Orchid ORM, which a JSON `null` value then cannot take.
  - Queries take the values of a type, unlike those of Orchid ORM, which take the database values, so decide what `isNull` means for such a type, and what `coalesce` and aggregates give for it.
- It needs nullability apart from the values in types and expressions, which a prototype measured, as [the decision of nullability](decisions/types/nullability-of-accepted-values.md) records with its pitfalls; measure again with these conversions before choosing a design.

## Several records of a relation `one`

To think about: an error that names the field when a relation `one` finds several records, such as where the database lacks a key that its table declares, instead of the SQLSTATE `21000` of PostgreSQL, such as by `LIMIT 2` and a check in decoding; measure its cost first.

## `$select` as a field of a selection

A query of `$select` as a field of a selection, such as of `select` or of another `$select`, nested as the rows of a query of a table are: packing reads a statement without a source through a derived source like any other, so it needs `RecordQuery` among the nested queries of a selection and its node in the nested selection node.

## Scalar fragments of kern-orm in pages after an offset

A page after an offset keeps the nested queries on its table when a nested query holds a SQL fragment that refers to a column of the table, also through a query nested in the fragment, as [architecture/sql.md](architecture/sql.md#nested-rows) states, since a fragment may aggregate the rows of the query.
Fragments that kern-orm builds are known to be scalar, such as the `coalesce` of the fallbacks of an aggregate in `form.fields.max("id").coalesce(form.id)` and the [functions of expressions](architecture/types.md#functions-of-expressions), yet they keep the page on its table too.

- Mark such fragments, such as by a flag of a raw node or a node kind of a function call, so that the check skips them while still walking their operands, which may hold a fragment of a user or an aggregate.
- Research first which fragments refer to the columns of a parent row: the fallbacks of aggregates, and possibly generic operators and the operators of custom types.
- Aggregates of a nested query whose arguments read both its source and a column of the table also keep the page on its table; telling them apart needs the sources of the query that holds them.

## SQL fragments of users in pages after an offset

Research and a decision: whether a SQL fragment of a user in a nested query can keep the nested queries of a page after an offset over the rows of the page, which kern-orm cannot tell from the text of the fragment, since a fragment may hold an aggregate of the rows of an enclosing query, such as a user-defined aggregate that only the catalog of the database knows.

- A contract that a fragment in a nested query never aggregates the rows of an enclosing query, for which the aggregate methods exist, would drop the check, but breaking it would change results silently rather than fail.
- A variant of `sql` for fragments that are known to be scalar would keep the check for other fragments, at the cost of a public API for a rare case.
- A fragment that does aggregate the parent rows makes the parent query return one row, so the nested queries run once anyway; only scalar fragments lose the speed-up, also those that read the parent table only through a query correlated with it, such as ``sql`${field.position} < ${form.fields.count()}` ``.

## Unions of queries of `find` and `findBy` by different keys

The state of a query of `find` and `findBy` has the columns of its key, which [`upsert`](architecture/mutations.md#upserts) reads, so a union of queries by different keys, such as `flag ? db.user.findBy({ email }) : db.user.find(id)`, is a union of different states, which rejects the methods that change the state, such as `select` and `get` ([decision](decisions/queries/state-changing-methods-on-unions.md)).

- A type parameter of `SelectQuery` for the key, apart from the state, would take such a union: the methods that change the state would take a query of any key and return one without a key, and `upsert` would infer the union of the keys of the union.
  It changes the `this` parameter or the result of nearly every method of a query; measure the cost with `bench:types`.
- Parts of the keys that are assignable to each other take such a union too, but type the values of `upsert` by another key ([decision](decisions/mutations/upsert-types.md)).

## Union of queries of several tables

Optional, research: a function that types a union of queries of several tables or kinds, such as `cond ? db.foo : db.bar`, as one query whose overloaded methods TypeScript can call, while a query of one table keeps its plain types.

- At runtime it returns its argument: methods resolve columns by name in the table of the chosen query.
- Its table has the columns that every table has with the same type; a column of the same name and another type and a relation of one table are unavailable.
- Its result and rows mode are the unions of those of the queries, and its kind is bound or unbound when every query is, and either kind otherwise.
- The state keeps the source tables as a new part, so that a `Db` still checks them against its schema.
- Check first whether a union of tables in the state, `SelectQuery<InitialQueryState<typeof foo | typeof bar>, Kind>`, already gives the common columns.
- Branches of a callback of `use` or of a helper that leave different states could become one query of a union state the same way.
- Alternatively, methods that change the state could apply to a union of queries by one of the designs that [architecture/queries.md](architecture/queries.md) weighs, at the costs it records.

## Schema views

Restricted views of schemas for business logic shared between schemas.

## Checking tables against the database

A check, such as in tests after migrating, that each table of a schema exists with its columns and their nullability, that a constraint or a unique index backs each of its keys, that a unique index of `(true)` backs each singleton table, and that a foreign key backs each required relation `one`, instead of generating migrations from tables, which [the scope of the migrator](decisions/migrations/migrator-scope.md) leaves out.

## Recurrent SQL of migrations

SQL that the migrator runs again after every migration, such as of functions and views, as rake-db runs recurrent migrations ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/migration-setup-and-overview.md#recurrent-migrations)).

## Migration helpers of enums

Helpers that change enum types: PostgreSQL cannot drop a value of an enum, so undoing an added value creates the type again with the columns that use it.

## Relation-aware mutations

A separate project.

- An update that deletes the record its selected records reference changes only the selected records; other records that reference it only lose the reference ([orchid-orm#853](https://github.com/romeerez/orchid-orm/issues/853)).

## Queries that may be `NULL` as values of columns that are not nullable

Types take a query of one value that is `NULL` without its row as a value of a column that is not nullable, such as `db.field.insert({ formId: db.form.where({ name }).get("id"), ... })`, and PostgreSQL rejects the statement without the row, while types reject an expression that may be `NULL` ([architecture/mutations.md](architecture/mutations.md#values)).

- Think again about whether types keep taking such a query, which moves the error from type-checking to the statement, or reject it as they reject an expression.
- Preliminary decision: types reject such a query unless it is explicitly marked as having its row, as the `!` operator of TypeScript marks a value.
  - The mark changes only the value of the query in an expression, `ScalarValue` of `query/operand.ts`, which already has no `null` for the guaranteed row of a required relation; PostgreSQL still rejects `NULL` for a column that is not nullable.
  - An executed query and a nested query of a selection reject without their row anyway, so the mark means nothing for them.
  - Decide the API of the mark with that in mind.

## Narrowing returned and accepted values apart

`of<T>()` narrows the values that a type returns and accepts to the same `T`, so a type that accepts more values than it returns loses them, such as the `Date` that `timestamptz` accepts beside its strings.
Orchid ORM 1.78.47 narrows the input, output, and query types of a column apart with `narrowAllTypes` ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/common-column-methods.md#narrowalltypes)).

## Branded types of columns

An opt-in `brand()` of a column gives its values a type distinct from other values of the same underlying type, so that types reject a mixed-up identifier, such as `db.field.find(formId)` or `db.field.where({ id: formId }).delete()`.

Orchid ORM has [`brand()`](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/common-column-methods.md#brand), which brands a column by its table and column by default and takes a token for a brand that columns share.
[orchid-orm#734](https://github.com/romeerez/orchid-orm/issues/734) also proposes inheriting the brand through a foreign key, which that documentation does not state.

Preliminary decisions:

- A brand exists only in types: it changes neither SQL nor runtime values.
- A brand also covers inputs, such as of `find`, `findBy`, `where`, `matches`, operators, `insert`, and `update`: `EqValue` reads `Operand<Output, Input>`, so a brand of the result alone still accepts an identifier of another column.
- Conditions stay structural, without a table of their own, so that one condition can apply to several tables:
  - A branded column rejects a condition of another table, such as `const condition: WhereCondition<typeof form> = { id }` in `db.field.where(condition)`.
  - Columns of one brand or without a brand do not, such as `{ active: true, tenantId }` of a parent table in `where` of its child.
  - The type of a condition of a table keeps its other columns as optional keys, so a condition of `form` with `{ published: true }` is rejected by a table whose `id` has another brand; a condition shared on purpose needs a narrow type, such as `{ published?: boolean }`.
- Relations do not inherit a brand: they belong to schemas, and the types of columns belong to tables.

Open questions:

- What identifies a brand, and how a primary key and its foreign keys share one.
- How a table shared by several schemas behaves.
- How users get a branded value from external input without a promise of runtime validation.
- How a brand passes through `nullable`, arrays, `transform`, expressions, subqueries, and `returning`.
- What brands cost to type-check, and how they appear in public declarations.
