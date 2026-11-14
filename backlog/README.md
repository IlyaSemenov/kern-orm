# Backlog

Work not done yet, ideas, and research, one file per item, in buckets by importance.
Within Next and Later, items run roughly from the most important; the order is a loose hint, not a plan.

## Next

- [Moving from rake-db](moving-from-rake-db.md): the applied versions of rake-db and a baseline of the schema.
- [Through and many-to-many relations](through-and-many-to-many-relations.md): relations through other relations and through a join table.
- [JSON operators](json-operators.md): `->`, `->>`, and functions of JSON paths typed by the shape.
- [Arithmetic operators](arithmetic-operators.md): `+`, `-`, and the increment of a column.
- [Updating records with values of each](updating-records-with-values-of-each.md): `UPDATE ... FROM (VALUES ...)` matched by a key.
- [Computed columns](computed-columns.md): columns defined as expressions, and fields computed at runtime.
- [Empty changes and `none()`](empty-changes-and-none.md): `upsert` without values and `insertMany` without records that change nothing, and queries known to be empty without a statement.
- [Conditions on columns of a related record](conditions-on-columns-of-a-related-record.md): a short condition on a column of a relation `one`, such as `where({ idea: { rubricId } })`.
- [Unions and common table expressions](unions-and-common-table-expressions.md): `UNION ALL`, `WITH`, and derived sources.
- [pgvector type](pgvector-type.md): `vector` with the operators of its distances.

## Later

- [Irreversible migrations in verification](irreversible-migrations-in-verification.md): migrations whose `down` cannot restore the structure, such as of an added enum value.
- [Upsert](upsert.md): telling an inserted row from an updated one, partial unique indexes, and a condition of the update.
- [Scopes and soft delete](scopes-and-soft-delete.md): predicates that a table applies to its queries, and `delete` that sets a column.
- [Inserting the records of a query](inserting-the-records-of-a-query.md): `INSERT ... SELECT`.
- [Queries repeated in a statement](queries-repeated-in-a-statement.md): a key of groups that holds a query, in `HAVING` and `ORDER BY`.
- [Parameters of keys without `param`](parameters-of-keys-without-param.md): binding every parameter once in a query of groups.
- [Queries in aggregates of first rows](queries-in-aggregates-of-first-rows.md): evaluating the argument only over the first rows of `distinctOn`.
- [First rows in another order](first-rows-in-another-order.md): `distinctOn` in an order that does not start with its keys.
- [Other options of aggregate functions](other-options-of-aggregate-functions.md): `distinct`, `WITHIN GROUP`, and `OVER`.
- [After-commit hooks](after-commit-hooks.md): callbacks that run after the outermost commit.
- [Columns of a violated unique constraint](columns-of-a-violated-unique-constraint.md): the keys of its columns on `QueryError`.
- [Integer keys of advisory locks](integer-keys-of-advisory-locks.md): beside the string keys of `$lock` and `$tryLock`.
- [Migrating every tenant](migrating-every-tenant.md): a migration command for every schema of a target.
- [Generated columns](generated-columns.md): columns that inserts and updates must not set.
- [Bulk inserts beyond the parameter limit](bulk-inserts-beyond-the-parameter-limit.md): `unnest` of arrays, or statements in a transaction.
- [Comparison with other projects](comparison-with-other-projects.md): a "Why kern-orm" section of the README and a page of the site.
- [Keyset pagination](keyset-pagination.md): pages after the sort keys of the last row.
- [Helpers of a mutation in types](helpers-of-a-mutation-in-types.md): what `use` of a mutation rejects only at runtime.
- [Index in the callback of `map`](index-in-the-callback-of-map.md): the arguments of `Array.map`.
- [`map` only of records](map-only-of-records.md): rejecting a query of one value.
- [`transform` and `map` beyond their current limits](transform-and-map-beyond-their-current-limits.md): `$select`, `count` after `map`, and others.
- [Records of a relation at any depth](records-of-a-relation-at-any-depth.md): `WITH RECURSIVE` over a relation of a table to itself.
- [Joins](joins.md): queries with joined tables.
- [Values before an update](values-before-an-update.md): `old` and `new` in `RETURNING` of PostgreSQL 18.
- [Statement timeout of test transactions](statement-timeout-of-test-transactions.md): opt-in `statement_timeout` and `lock_timeout` of each test level.
- [Helper effects of their calls](helper-effects-of-their-calls.md): effects that record calls, so that types check what the runtime checks.
- [Relations of conditions in types](relations-of-conditions-in-types.md): whether types check the relations that a condition reads.
- [Aggregates by the type of their argument](aggregates-by-the-type-of-their-argument.md): types reject an argument that PostgreSQL cannot aggregate.
- [Decoding `NULL` to a value](decoding-null-to-a-value.md): types that map `NULL` and a value both ways.
- [`$select` as a field of a selection](select-as-a-field-of-a-selection.md): a nested query of `$select`.
- [Scalar fragments of kern-orm in pages after an offset](scalar-fragments-of-kern-orm-in-pages-after-an-offset.md): marking fragments known to be scalar.
- [SQL fragments of users in pages after an offset](sql-fragments-of-users-in-pages-after-an-offset.md): whether a fragment of a user keeps a page on its table.
- [Unions of queries of `find` and `findBy` by different keys](unions-of-queries-of-find-and-findby-by-different-keys.md): a type parameter of the key apart from the state.
- [Schema views](schema-views.md): restricted views of schemas for shared business logic.
- [Recurrent SQL of migrations](recurrent-sql-of-migrations.md): functions and views run again after every migration.
- [Migration helpers of enums](migration-helpers-of-enums.md): changing enum types.
- [Changes outside a transaction in verification](changes-outside-a-transaction-in-verification.md): checking the changes that run outside a transaction block.
- [Queries that may be `NULL` as values of columns that are not nullable](queries-that-may-be-null-as-values-of-columns-that-are-not-nullable.md): rejecting them unless marked as having their row.
- [Narrowing returned and accepted values apart](narrowing-returned-and-accepted-values-apart.md): `of<T>()` for the values that a type returns and those it accepts.
- [Branded types of columns](branded-types-of-columns.md): an opt-in `brand()` that rejects a mixed-up identifier.

## Without a use case

Ideas that wait for an application that needs them, or that are not planned.

- [Several records of a relation `one`](several-records-of-a-relation-one.md): an error that names the field.
- [Union of queries of several tables](union-of-queries-of-several-tables.md): one query typed from `cond ? db.foo : db.bar`.
- [Relation-aware mutations](relation-aware-mutations.md): a separate project.
