# Backlog

Work not done yet, ideas, and research, roughly from the most important; the order is a loose hint, not a plan.

## Queries as expressions

A query as an expression in conditions, sort keys, operands, and SQL fragments, beside a field of a selection, so that conditions such as access checks are built of typed queries rather than of SQL text that names tables and aliases:

- `EXISTS` of a query as a condition and as a selected value, such as the forms that have submissions or the submissions without comments, and as a query of a `boolean` value, such as `await db.form.where({ published: true }).exists()`.
  It takes a query of a relation, a query of a table without correlation, and a query that a helper prepares.
- `in` of a query of values, such as of `pluck` of the groups of a user, beside a list of values.
- A query of one value, such as of `get` or of an aggregate, as a scalar subquery of the type of its value, such as `form.fields.count()` or `form.fields.max("position")` in a comparison or in `orderBy`, so that `orderBy` sorts by an aggregate of related records through the selected fields.
  Then `coalesce` could also be a function of expressions, beside the method of queries of values.
- A query with clauses interpolated into `sql` as a subquery, such as ``sql`EXISTS (${query})` ``, which `sql` rejects so that it can take this meaning, as [architecture/types.md](architecture/types.md#parameters-and-sql-fragments) states.
- The callbacks of `where` and `orderBy` receive the relations of the table, as that of `select` does.
- A condition on the columns of the record of a relation `one`, such as of the fields of published forms, shorter than `EXISTS` of the relation.
- Decide how a query becomes an expression: methods of a query that return expressions, such as `exists`, the operators of the type of its value on a query of one value, or a function of a query.

## Functions of expressions

Functions of expressions typed by their operands, for values and conditions that operators do not cover, such as the weight of the role of a user from several sources, `GREATEST(COALESCE((SELECT max(CASE ... END) ...), 0), ...)`:

- `coalesce`, `greatest`, `least`, and `CASE`, such as functions exported by `kern-orm` beside `and`, `or`, and `not`.
- Their result is `NULL` by rules of their own, which types follow, as for `and` and `or`: `coalesce` only when every operand is, `greatest` and `least` ignore `NULL` operands, and `CASE` without `ELSE` is `NULL` when no branch matches.
- Constants serve as the neutral branch of a condition built in code, such as `FALSE` in `condition ? check : FALSE`, and as fallbacks, such as `0`: an empty `or()` is `FALSE`, an empty `and()` is `TRUE`, and `param(t.integer, 0)` is a typed value, but the user documentation shows none of them as such; decide whether documenting them is enough.

## Reusable expressions with arguments

An expression over the columns and relations of a table that queries of the table reuse with arguments, such as whether a user can moderate a record, which a query both selects and filters by, while `defineFilter` reuses only a condition without arguments.

- `where` and `orderBy` resolve columns against the source rather than the selected fields, as [architecture/queries.md](architecture/queries.md#selection) states, so a query that filters by a field it selects calls such an expression in both.
- A function of `ColumnRefs<T>`, `RelationRefs<T>`, and the arguments may be enough once [queries are expressions](#queries-as-expressions); then document the pattern beside filters and helpers instead of adding an API.
- Otherwise, decide whether `defineFilter` takes further arguments, as `defineHelper` does, and whether it defines expressions of types other than `boolean`.

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

## Identifiers in SQL templates

A fragment of a quoted name, such as `sql.identifier(name)`, for the templates of `query`, `script`, and `sql`, so that a statement names a table or a column known only at runtime, such as in a migration that changes several tables in a loop.
In `query` and `sql`, the values of the statement stay parameters; a script keeps having no parameters:

```ts
await database.query`UPDATE ${sql.identifier(table)} SET updated_at = ${now}`
```

- An interpolated string becomes a parameter of `query`, which PostgreSQL rejects in place of a name, so such code builds SQL text with `quoteIdentifier` of `@kern-orm/migrations` and puts values into it with `quoteLiteral`.
- Decide whether it takes a qualified name, such as of a schema and a table.
- Steps of SQL text and the helpers of `@kern-orm/migrations` keep `quoteIdentifier`, since a fragment is not text, and the migrator imports only types from `kern-orm`.

## Row locks

Locking the rows that a query reads, as `SELECT ... FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE`, or `FOR KEY SHARE`, with `NOWAIT` or `SKIP LOCKED`, such as for a queue of jobs.

- PostgreSQL rejects a locking clause in a query of aggregates, `DISTINCT`, or `GROUP BY`, so reject it in a query of an aggregate method.
- The clause locks the rows of the tables in `FROM` of its query, including those of a derived source, but not the related records of nested queries in the select list; decide whether lowering keeps the clause when it packs the query into a derived source, such as a page after an offset.
- A nested query and a query of an expression lock their own rows, such as a query of one value in the values of an insert that locks the record that the inserted one belongs to.
  Lowering puts the clause of packed nested rows into the derived source that reads their rows, since PostgreSQL rejects it beside their aggregate.
- Orchid ORM 1.78.47 takes the tables to lock, as `FOR UPDATE OF` ([docs](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/transactions.md#forupdate)); kern-orm selects related records in subqueries of the select list, which the clause of the query does not lock, so decide whether a query needs to name its tables.
- Outside a transaction the lock ends with its statement, so decide whether a locking query rejects outside one.

## `transform` and `map` of a query

`transform` and `map` of a query, as in Orchid ORM, such as `max("position").coalesce(0).transform(position => position + 1)`:

- `transform` converts the whole result of the query after decoding, executed or nested, including a missing row and the array of rows;
- `map` converts each record or value of the result and skips a missing row; decide whether it also skips a `NULL` value, such as of an aggregate without rows.
- They change the result in types but not the SQL, so decide which methods apply after them, such as `where` and `select`, and how `orderBy` of the selected fields, helpers, and the paths of decoding errors treat a converted value.

## Through and many-to-many relations

Relations through other relations, such as the answers of a form through its fields, and many-to-many relations through a join table, which queries select and filter by as other relations, as `chain` of Orchid ORM 1.78.47 queries the related records of related records ([docs](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/relation-queries.md#chain)).

- `EXISTS` of a chain correlates each relation with its own source; Orchid ORM joined the chained table to the outer one by the columns of the chained relation ([orchid-orm#851](https://github.com/romeerez/orchid-orm/issues/851)).
- Decide whether `$relations` declares a through relation, a query of a relation chains another relation, or both.

## Upsert

An insert that updates or skips the record it conflicts with on a key, as `INSERT ... ON CONFLICT ... DO UPDATE` or `DO NOTHING`, such as the row of a singleton table that the [motivation](architecture/README.md#motivation) names.

- Upserts take their conflict target from the keys of the table, such as from `findBy` before the upsert, whose values the inserted record takes too.
  Orchid ORM 1.78.47 `upsert` of a query of `find` or `findBy` updates the record and creates it when missing ([docs](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/create.md#upsert)).
- `DO NOTHING` takes a key as its target, or no target to skip a record that conflicts on any key, as `onConflictDoNothing` of Orchid ORM ([docs](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/create.md#onconflictdonothing)).
- Decide how the values of the update refer to the values of the insert, `EXCLUDED` of PostgreSQL, such as by an argument of the callback of the update values.
- `DO NOTHING` returns no row for a record that conflicts, so the fields that it selects for one record have rows `optional`, and those of several records lack the rows of the records that conflict.
- The upsert of the row of a [singleton table](#singleton-tables) takes no key, which depends on what guarantees that the table holds one row: `ON CONFLICT` requires a unique index, such as of a constant expression.
- PostgreSQL rejects `DO UPDATE` of a statement whose records conflict with the same row twice, such as an `insertMany` of two records of one key, with SQLSTATE `21000`.

## Grouping

Groups of the rows of a query, as `GROUP BY`, with the aggregates of each group, a filter of the groups by their aggregates, as `HAVING`, and an order by an aggregate, such as the participants of a contest with a positive sum of points, in the order of the sum, as `group` and `having` of Orchid ORM 1.78.47 ([docs](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/query-methods.md#group)).

- The aggregate methods turn the rows of the whole query into one value, so the aggregates of groups need another form, such as aggregate functions of expressions in `select`, `having`, and `orderBy`.
- A query of groups selects only the columns it groups by and aggregates; decide how types reject other columns.
- Decide how lowering nests a query of groups in a selection and reads a page of groups after an offset.

## Snake case column names

Column names derived from their keys in snake case, such as `form_id` of `formId`, so that a table of such columns needs no `columnName` on each of them, as `snakeCase` of Orchid ORM 1.78.47 ([docs](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/base-table.md#snakecase)); `columnName` overrides the derived name.

- `defineTable` takes the name of its table, so only column names are derived.
- Decide where the option is given, such as to `defineTable` or to a function that creates `defineTable` for every table of a project, as `createTableFactory` of Orchid ORM.
- Orchid ORM puts `_` before each capital letter, such as `user_i_d` of `userID`, and keeps digits ([`toSnakeCase`](https://github.com/romeerez/orchid-orm/blob/main/packages/pqb/src/utils.ts)); decide the conversion, and whether it matches that of Orchid ORM, so that tables moved from Orchid ORM keep their column names.

## Scopes and soft delete

Predicates that a table applies to its queries, such as excluding soft-deleted records, kept as the `scope` filters of a query, like `scopes` of Orchid ORM 1.78.47 ([docs](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/scopes.md)).

- Scope predicates are never operands of a user `OR`; test it ([orchid-orm#845](https://github.com/romeerez/orchid-orm/issues/845)).
- A scope that may exclude records ends the guarantee of the row as a filter does, so a query of a required relation to a table with such a scope starts with rows `nullable`.
- A scope applies to every query of its table, including queries of relations to it, nested queries, and queries of expressions, unless a query leaves it out by name, as `unscope` of Orchid ORM, such as to list deleted records.
- Decide whether a table or a schema declares scopes, as a schema declares relations.
- Soft delete builds on a scope: `delete` of a table with soft delete sets its column, such as `deletedAt` to `now()`, instead of deleting the rows, and a hard delete deletes them, as `softDelete`, `includeDeleted`, and `hardDelete` of Orchid ORM 1.78.47 ([docs](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/soft-delete.md)).
- A scope predicate does not restrict the rows of `update` and `delete`, which reject without another filter unless `all` allows it, as [architecture/mutations.md](architecture/mutations.md#rows-to-change) requires and as Orchid ORM does for soft delete.
- A table interpolated into `sql` is its name, which no scope filters.

## String unions of text types

Text types whose values are a union of strings, such as the visibility of a comment that a `CHECK` constraint limits rather than a PostgreSQL enum, as `json.of<T>()` declares a shape, such as `t.text.of<"public" | "private">()` and `t.varchar.of<...>()`.
Orchid ORM 1.78.47 narrows a column with `narrowType` ([docs](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/common-column-methods.md#narrowtype)).

- Decide whether `of` narrows the values of every type, such as number literals of `integer`, and which operators take the union, such as `eq` and `in`, while `like` keeps a string pattern.

## Queries as values of inserts and updates

Values of an insert or an update that a query of one value gives in the same statement, such as the record that an inserted one belongs to, locked by a [row lock](#row-locks), or the position after the last record of an ordered collection, `max("position")` plus one, rather than a read before the statement; a value takes such a query as a scalar subquery once [queries are expressions](#queries-as-expressions).
Orchid ORM 1.78.47 takes a query of one value as the value of a column, such as `() => db.other.find(id).get("name")` ([docs](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/create.md#sub-queries)), and inserts the records of a query with `createOneFrom` and `createForEachFrom` (`INSERT ... SELECT`, [docs](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/create.md#createonefrom-insertfrom)); kern-orm takes values and expressions only, and rejects a query as a value.

## Empty changes and `none()`

An `update` without values and an `insertMany` without records reject, as [architecture/mutations.md](architecture/mutations.md#values) states.
Two independent goals:

1. Take them as changing nothing, so that code that passes the values of a request, such as of a PATCH, needs no check such as `if (Object.keys(values).length > 0)` before `update`.
   - An `update` without values changes no row, and with selected fields selects them from the rows it would change, so that a query of `find` still checks its record.
     Orchid ORM 1.78.47 turns it into a select of the rows, `SELECT count(*)` without selected fields ([docs](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/update.md#empty-set)).
   - An `insertMany` without records changes no row: the number `0`, or an empty array of the selected fields.
   - Decide what an `update` without values and without selected fields resolves to, such as `0` without a statement, and whether a query of `find` then checks its record.
2. Skip the statement when its result is known without the database: a query of `none()`, a filter of `FALSE`, such as of `in([])`, or an `insertMany` without records resolves to no rows without a roundtrip.
   - Orchid ORM 1.78.47 resolves a query of `whereIn` of an empty list without querying the database ([docs](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/where.md#wherein)), and code that filters by a list from a request relies on it.
   - Decide what `toSQL` and `$compile` give for a query without a statement.

## Distinct rows

Rows of a query without duplicates, as `SELECT DISTINCT`, such as of `pluck` of the users of notifications for `in` of a query, and possibly the first row of each group in the order of the query, as `DISTINCT ON`, as `distinct` of Orchid ORM 1.78.47 ([docs](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/query-methods.md#distinct)).

- PostgreSQL requires the sort expressions of `SELECT DISTINCT` in its select list, and packing adds the sort keys of nested rows to the projections of their derived source, where `DISTINCT` would compare them too; decide how lowering keeps distinct rows sorted by an expression that the query does not select.

## Arithmetic operators

Operators of numeric expressions, such as `+` and `-`, and the increment of a column, such as of the number of comments of a record, which an update writes as ``sql(t.integer)`${record.commentsCount} + 1` ``, as `increment` and `decrement` of Orchid ORM 1.78.47 ([docs](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/update.md#increment)).

- They are a capability of numeric types, which [aggregates by the type of their argument](#aggregates-by-the-type-of-their-argument) would read too.
- Decide the type of the result of operands of different types, such as `integer` and `bigint`, and of dates and intervals.
- They add to the operators of every numeric column reference, so measure their cost with `bench:types`.

## JSON operators

Operators of `json` and `jsonb` expressions typed by the shape of `of<T>()`, such as `->` and `->>` of a key, to filter by a property, such as `config->>'fieldType' = 'rate'`, and functions of JSON paths, such as `jsonb_path_query_first`, as Orchid ORM 1.78.47 has them ([operators](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/where.md#jsonb-column-operators), [functions](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/json.md)).

- Decide the type of `->>` of a property that is not a string, which PostgreSQL gives as text.
- A missing property is `NULL` whatever the shape, which kern-orm does not validate, so decide whether an expression of a required property is nullable.

## Computed columns

Columns that a table defines as expressions over its other columns, which queries select, filter, and sort by their keys, such as the kind of an event that a key of its JSON details holds, and fields computed at runtime from selected columns, as `computed` and `computeAtRuntime` of Orchid ORM 1.78.47 ([docs](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/computed-columns.md)).

- Decide whether a table or a schema defines them, so that they can read relations, as a schema defines relations, such as the profit of a record from its related records.
- Inserts and updates reject them, as [generated columns](#generated-columns); decide whether `select("*")` selects them.
- Fields computed at runtime could be [`map`](#transform-and-map-of-a-query) of a query instead.

## Updating records with values of each

An update of several records, each with its own values, such as the positions and titles of the fields of a form from a request, in one statement, `UPDATE ... FROM (VALUES ...)` matched by a key, with the values encoded by the types of their columns rather than SQL types written by hand, as `updateMany` and `updateManyBy` of Orchid ORM 1.78.47 ([docs](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/update.md#updatemany)).

- The parameters of `VALUES` have no column to type them, so the statement casts them to the cast types of their columns, as `param` with a type does.
- Arrays of the values of each column, `unnest($1::uuid[], $2::text[])`, would keep the text of the statement the same for any number of records and their parameters within the limit, as [bulk inserts beyond the parameter limit](#bulk-inserts-beyond-the-parameter-limit) weighs for inserts.
- Decide whether a record without a row rejects, as a query of `find` does, and whether records may set different columns.

## After-commit hooks

Callbacks that run after the current transaction commits, such as sending the notifications of the changes it made, as `$afterCommit` of Orchid ORM 1.78.47 does ([docs](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/transactions.md#aftercommit)).
A hook belongs to the level that registers it: rolling the level back discards it, releasing the level passes it to the enclosing level, and it runs after the outermost commit, so that it runs only for the work that the commit keeps, whichever `Db` of the database registers it, as the [motivation](architecture/README.md#motivation) requires.

- Decide what a hook registered outside a transaction does; Orchid ORM runs it on the next microtask.
- Decide how a failure of a hook is reported once the transaction has committed; Orchid ORM leaves it to `uncaughtException` or `unhandledRejection`.
- The outermost transaction of code under test is a nested level of the test level, which never commits: decide whether its hooks run when it is released, as in production, and whether the rollback of the test level waits for them, as in Orchid ORM ([docs](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/transactions.md#after-commit-hooks-in-tests), [orchid-orm#822](https://github.com/romeerez/orchid-orm/pull/822)), so that their queries roll back with the test.
  A test level does not count as a transaction for [joining](architecture/transactions.md#joining).

## Type of the fields of a helper

A type of the fields that a helper selects, such as of the records that a function returns from a query of the helper: `ResultOf` takes a query, while the fields are `E["fields"]` of `Helper<T, E, A>`, which `infer` reads from `typeof helper`.
Decide between `ResultOf` of a helper and a type of its own.

## Sorting by a field of a related record

Sorting by a field of the related record of a relation `one`, such as fields by the name of their form; keep the design of sorting and relations open to it.
The answers of a submission in the order of their fields need it too: `getSubmissionReview` of `examples/forms` selects the fields of the form in their order with the answer of each instead.

- A scalar subquery of the relation in `orderBy`, such as of `get` of the name of the form, gives it once [queries are expressions](#queries-as-expressions); benchmark a join against it, such as with an index of the order.

## Advisory locks

A lock of `pg_advisory_xact_lock` held by the current transaction, such as `db.$lock(key)`, which hashes a string key with `hashtextextended(key, 0)` and rejects outside a transaction, where the lock would end with its statement.

- Decide whether it also takes the integer keys of PostgreSQL, and a variant that returns instead of waiting, `pg_try_advisory_xact_lock`.
- Decide whether `Database` has it too, as it has `transaction`, so that the [migrator](architecture/migrations.md#applying-and-rolling-back), which locks its target the same way, uses it.

## Migrating every tenant

A command of the migration command line for every schema of a target whose PostgreSQL schema is a function, such as all tenants, from a list of schemas that the project gives.

## Singleton tables

Tables that hold at most one row, such as the settings of an application, whose entry points start queries of one row, so that reading, updating, and [upserting](#upsert) the row need no sentinel key or `all().take()` ([orchid-orm#752](https://github.com/romeerez/orchid-orm/issues/752)).

- `optional`, `nullable`, and `required` apply to the queries of their entry points, as to other queries of one row.
- Decide what guarantees that the table holds at most one row, and whether that guarantee lets its mutations go without a restriction or `all()`, which [architecture/mutations.md](architecture/mutations.md#rows-to-change) otherwise requires.

## Runtime defaults of columns

A column can declare a default that kern-orm gives an insert that omits the column: `.default(value)`, or `.default(() => value)`, called for each inserted record, such as `t.uuid.primaryKey().default(() => randomUUID())`.
`hasDefault()` stays the mark of a default of the database.

- An insert may omit a column with a runtime default, as one marked with `hasDefault`.
- Decide whether a default can be an expression, such as a `sql` fragment.
- Orchid ORM 1.78.47 takes a value or a `sql` fragment of `.default` as a default of the database, which its migrations declare, and only a callback as a default at runtime ([docs](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/common-column-methods.md#default)); in kern-orm, a value of `.default` is a runtime default as well.

## Generated columns

Columns that the database computes, such as `GENERATED ALWAYS AS (...) STORED`, which inserts and updates must not set; `hasDefault` lets inserts omit them but still takes values for them.

## Bulk inserts beyond the parameter limit

A helper or an opt-in option of a query for inserts of more values than the 65535 parameters of a statement, such as tens of thousands of records, which `insertMany` rejects, as [architecture/mutations.md](architecture/mutations.md#statements) states.

- Records of the same columns of plain values could be sent as one array parameter of the text representations of each column, `INSERT ... SELECT ... FROM unnest($1::text[], $2::text[])` cast to the types of the columns, whose text does not depend on the number of the records; records that omit a column for its `DEFAULT` or give an expression need `VALUES`.
- Alternatively, the helper splits the records into statements in a transaction of its own; then a later statement sees the rows of an earlier one, unlike one statement.
  Orchid ORM splits such an insert by itself, and a failure of a later statement left the transaction aborted ([orchid-orm#811](https://github.com/romeerez/orchid-orm/pull/811)).
- Benchmark the variants against `VALUES` for small and large numbers of records before choosing.

## Comparison with other ORMs

A "Why kern-orm" section of the README and a page of the site that compare kern-orm with other ORMs and query builders, such as Drizzle ORM, Kysely, Prisma, and Orchid ORM, in the scenarios where it differs: related records in one statement, ambient transactions, tables and queries reused across PostgreSQL schemas, and tests in transactions that roll back.

- Collect the differences from the records of other ORMs in tests, [architecture/](architecture/README.md), and this backlog.
- State each behavior of another ORM only as checked in its documentation, issues, or a named version, with a link.

## Keyset pagination

Pages after the sort keys of the last row of the previous page, reading the order of a query, which its node keeps as expressions with directions; how code outside kern-orm reads the order is not designed.

## Records of a relation at any depth

Records of a relation of a table to itself at any depth through `WITH RECURSIVE`, such as the fields shown after a field directly or through others, or the ancestors of a category; nested queries of a relation reach only the depth that a query spells out.

## Unions and common table expressions

`UNION ALL` of queries, `WITH` queries, and queries of a derived source of another query, such as the nearest administrators of a record among those of its ancestors.
[Records of a relation at any depth](#records-of-a-relation-at-any-depth) need `WITH RECURSIVE` too.

## Joins

Queries with joined tables:

- Decide which sources the column values of `where` resolve against, whether they can address joined tables, and how a callback receives the columns of joined tables.
- `SelectQuery` is typed by a single table and will need the shape of all query sources.
- A column of a source joined with `LEFT JOIN` is `NULL` without a match whatever its type, so its result type needs the nullability of the join.

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
- a query of values rejects a helper that calls `nullable` before `optional` or `required`, also when the call is in a helper that it applies.

It needs a new part of the query state, so measure its cost with `bench:types` before choosing a design.

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

## Several records of a relation `one`

To think about: an error that names the field when a relation `one` finds several records, such as where the database lacks a key that its table declares, instead of the SQLSTATE `21000` of PostgreSQL, such as by `LIMIT 2` and a check in decoding; measure its cost first.

## `$select` as a field of a selection

A query of `$select` as a field of a selection, such as of `select` or of another `$select`, nested as the rows of a query of a table are: packing reads a statement without a source through a derived source like any other, so it needs `RecordQuery` among the nested queries of a selection and its node in the nested selection node.

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

## Union of queries of several tables

Optional, research: a function that types a union of queries of several tables or kinds, such as `cond ? db.foo : db.bar`, as one query whose overloaded methods TypeScript can call, while a query of one table keeps its plain types.

- At runtime it returns its argument: methods resolve columns by name in the table of the chosen query.
- Its table has the columns that every table has with the same type; a column of the same name and another type, a filter of `defineFilter`, and a relation of one table are unavailable.
- Its result and rows mode are the unions of those of the queries, and its kind is bound or unbound when every query is, and either kind otherwise.
- The state keeps the source tables as a new part, so that a `Db` still checks them against its schema.
- Check first whether a union of tables in the state, `SelectQuery<InitialQueryState<typeof foo | typeof bar>, Kind>`, already gives the common columns.
- Branches of a callback of `use` or of a helper that leave different states could become one query of a union state the same way.
- Alternatively, methods that change the state could apply to a union of queries by one of the designs that [architecture/queries.md](architecture/queries.md) weighs, at the costs it records.

## Schema views

Restricted views of schemas for business logic shared between schemas.

## Checking tables against the database

A check, such as in tests after migrating, that each table of a schema exists with its columns and their nullability, that a constraint or a unique index backs each of its keys, and that a foreign key backs each required relation `one`, instead of generating migrations from tables, which [architecture/migrations.md](architecture/migrations.md#not-added) leaves out.

## Recurrent SQL of migrations

SQL that the migrator runs again after every migration, such as of functions and views, as rake-db runs recurrent migrations ([docs](https://github.com/romeerez/orchid-orm/blob/main/docs/src/guide/migration-setup-and-overview.md#recurrent-migrations)).

## Migration helpers of enums

Helpers that change enum types: PostgreSQL cannot drop a value of an enum, so undoing an added value creates the type again with the columns that use it.

## Relation-aware mutations

A separate project.

- An update that deletes the record its selected records reference changes only the selected records; other records that reference it only lose the reference ([orchid-orm#853](https://github.com/romeerez/orchid-orm/issues/853)).
