# Decisions

Trade-offs between designs of kern-orm: what each decision chose, the alternatives it weighed, their measured costs, and the other projects that chose an alternative.
Architecture states the chosen designs and links each decision from the contract of its design.

## Queries

Query objects, their types, and the methods that choose rows.

- [Query methods typed by `this`](queries/query-methods-typed-by-this.md): a query is covariant in its state, so comparing queries compares states.
- [State-changing methods on unions of queries](queries/state-changing-methods-on-unions.md): a union of queries of different states rejects them.
- [Query classes without a base class](queries/query-classes-without-base-class.md): each class repeats a few declarations.
- [A query as a thenable, not a `Promise`](queries/queries-not-promises.md): an awaitable query has `then`, `catch`, and `finally` and fits `PromiseLike`, rather than `Promise`, whose users attach several handlers to work that has started.
- [The members of a bound query as interfaces](queries/bound-members-as-interfaces.md): `then`, `catch`, and `finally` name interfaces, which cost less to check for each use of a helper than function types written in their conditional types, and 1 instantiation more in 66 of the other benchmarks.
- [`catch` and `finally` typed by the kind](queries/catch-and-finally-typed-by-kind.md): accessors that return `undefined` for an unbound query, rather than methods typed by `this`, which cost less to check.
- [Dynamic column keys in `select`](queries/dynamic-column-keys.md): optional fields for keys a call may omit.
- [Column keys typed as string literals](queries/string-literal-column-keys.md): a key typed as a member of a string enum is not told as the column of its value, rather than naming each field of every selection by the name of its key.
- [Row locks rejected by the state in types](queries/row-lock-state.md).
- [Relations in the references of callbacks](queries/relations-in-callbacks.md).
- [One parameter of `$execute` for every class of query](queries/execute-parameter.md).
- [`ResultOf` of a helper](queries/result-of-a-helper.md): one type for the record of a query and of a helper, rather than a type of its own.
- [Arrays of nodes not frozen](queries/unfrozen-node-arrays.md).
- [Comments of nested queries left out](queries/comments-of-nested-queries.md): only the query that runs a statement writes its comment.

## Filters and expressions

Filters, queries in expressions, and SQL fragments.

- [Filter of `where` as a conditional type](expressions/where-filter-type.md): it types literals of a callback by their columns.
- [One signature of `in`](expressions/in-signature.md).
- [`expr` of a query of one value](expressions/expr-of-queries.md): the operators of a query value come from an expression, not from methods of the query.
- [The `valueType` part of the state](expressions/value-type-part.md).
- [`identifier` as a function of its own](expressions/identifier-function.md).
- [`joinSql` as a function of its own](expressions/join-sql-function.md): rather than `sql.join`, with an empty array rejected when it is called rather than joined into empty SQL.
- [`literal` of a value and `unsafeSql` of text](expressions/literal-and-unsafe-sql.md): numbers as numeric constants and strings as `quote_literal` writes them, rather than quoted numbers, and text that the name marks as unchecked, rather than `rawSql` or a function of keywords.
- [`matches` checks its object by its own keys](expressions/matches-checks-own-keys.md).
- [Recognizing an operand by one lookup](expressions/operand-recognition.md).
- [Operand of an object condition read from the column type](expressions/object-condition-operand.md).
- [Result of arithmetic of the type of the expression](expressions/arithmetic-result-type.md): not read from the types of both operands.
- [Name of the negative inner product](expressions/negative-inner-product.md): `negativeInnerProduct` of the value of `<#>`, rather than `innerProduct` or `maxInnerProduct`.

## Aggregates and groups

- [The `aggregate` part of the state](aggregates/aggregate-part-of-state.md).
- [State of an aggregate of a callback](aggregates/aggregate-state-of-callbacks.md).
- [Keys of `groupBy` name columns](aggregates/group-keys-name-columns.md).
- [One callback type of `having`](aggregates/having-callback-parameters.md).
- [Nullability of aggregates in groups](aggregates/aggregate-nullability-in-groups.md): direct aggregates keep only argument nullability, with an ownership check.
- [The `fieldTypes` part of the state](aggregates/field-types-part.md): deferred, typed by the types of the fields rather than by their decoded values.

## Converting results

- [`map` without a part of the state of its own](results/map-state.md).
- [The `transformed` member of a query of `transform`](results/transformed-member.md).

## Mutations

- [Changes of the state of a mutation](mutations/mutation-state-changes.md).
- [Overloads of `update`](mutations/update-overloads.md).
- [No guaranteed order of the rows of `insertMany`](mutations/order-of-inserted-rows.md).
- [Actions of a conflict as methods of `onConflict`](mutations/conflict-actions.md).
- [Types of `upsert`](mutations/upsert-types.md): the state of `find` as an interface, and values of a mapped type of their own.
- [Update without values as a select without a lock](mutations/update-without-values.md).
- [Defaults of kern-orm added when the insert runs](mutations/runtime-defaults-when-the-insert-runs.md).
- [An increment as an operator](mutations/increment-as-an-operator.md): `add` in the callback of `update` rather than `increment`.

## Queries of SQL text

- [Columns of SQL text checked after the statement](sql-queries/columns-of-sql-text.md).
- [Indexing wide result column lookups](sql-queries/result-column-lookup.md): scans for small lookups, an index of selected names for larger ones, resolved once per result.
- [Result columns of a record named by its fragment](sql-queries/result-columns-of-records.md): rather than read by the names of the columns of the table or by position.
- [Values of the columns of a record told by key](sql-queries/values-of-columns-by-key.md): a key has the values of every column of the list that names it, rather than of the column at the position that guarantees it or of the columns whose keys overlap its names.
- [Return type of `columnsOf` kept out of inference](sql-queries/columns-of-return-type.md): `NoInfer`, rather than a plain return type, which a call in a field of `select` also infers the columns from, or two overloads.
- [`RecordOf` of the columns of a record](sql-queries/record-of-columns.md): a type of its own in `kern-db`, rather than `ResultOf` of both packages, whose tried forms reject passing a record of generic columns from kern-orm to `kern-db`, or a type of any field of `select`.
- [A missing row told by the key columns](sql-queries/missing-row-by-key-columns.md): the columns of a record that is `null` without its row include their key or name the columns that tell a missing row in `by`.
- [`queryOn` of an executor of statements](sql-queries/query-on-an-executor.md): a function that returns the template of a driver, a connection, or a wrapper of `execute`, rather than a method of a fragment, `query` of `Driver` and `Connection`, or a `Database` over each of them.
- [`$queryOn` of a `Db`](sql-queries/query-of-a-db-on-an-executor.md): the template of `$query` on an executor, rather than a method of a query of SQL text that replaces its executor, a `Db` bound over an executor, or a `queryOn` of `kern-orm` that compiles by the `Db` of its tables.
- [`query` of a `Database` as a property](sql-queries/query-of-a-database-as-a-property.md): of the type `SqlQueryTemplate` that `queryOn` returns, rather than a method, which an implementation of `Database` could declare with narrower parameters, and a subclass could override with a method.

## SQL generation

Lowering and the statements that the compiler builds, apart from nested rows.

- [Lowering visits every node](sql/lowering-visits-every-node.md).
- [Parameters of casts bound once in a statement](sql/parameters-of-casts.md): in every statement, by the identity of the cast, rather than at each place or only in a query of groups.
- [Keys of fields read by a read expression](sql/keys-of-read-fields.md): a query sorts and groups by the value itself, through a derived source where a clause takes the value from its projection, rather than by the position of the field, by a repeated expression, or rejecting the query.

## Nested rows

The SQL that loads nested queries and relations.

- [Nested queries as scalar subqueries](nested-rows/nested-queries-as-scalar-subqueries.md): rather than `LATERAL` joins.
- [Pages and first rows from derived sources](nested-rows/pages-from-derived-sources.md).
- [Nested aggregate queries unpacked](nested-rows/nested-aggregates-unpacked.md).
- [Packed rows as positional arrays](nested-rows/packed-rows-as-arrays.md).
- [`OFFSET 0` only on sources of scalar expressions](nested-rows/offset-barrier.md).
- [Sort keys of packed rows](nested-rows/sort-keys-of-packed-rows.md): rather than `row_number()`.

## Types

- [Values narrowed in types by `of`](types/narrowed-values.md): rather than by a list of values at runtime.
- [Nullability read from the accepted values](types/nullability-of-accepted-values.md): rather than kept apart from the values in types and expressions.
- [One name for the types of both packages](types/type-names-of-both-packages.md): `Type` and `defineType` in `kern-db` and `kern-orm`, rather than `Codec` or `SqlType` in `kern-db`.
- [Members of the type of `kern-db` declared again in the type of the ORM](types/db-type-members-of-a-type.md): rather than inherited from `Type` of `kern-db` or shared through a higher-kinded type.
- [`NULL` decoded to a value by a nullable type](types/null-decoded-to-a-value.md): `nullableAs`, which changes only what a result returns, and in the ORM applies only to a type whose values include `null` apart from `NULL`, rather than a value mapped to `NULL` both ways, `encodeNull` beside it, an overload of `nullable`, or values without `null` that the types of expressions do not tell.
- [Separate JSON types for the `jsonNull` marker](types/json-null-marker.md): `jsonWithJsonNull` and `jsonbWithJsonNull`, which return and take a top-level JSON `null` value as `jsonNull`, rather than an option of `of`, a method of the JSON types, a helper for `transform`, a marker of the application, or a marker object.
- [Read expression declared by a type](types/read-expression-of-a-type.md): as SQL text that its `decode` reads the result of, rather than an option of the columns of a record, a second decoder of a built-in type, or a function of `sql` fragments.
- [Decoding quoted array elements in slices](types/quoted-array-elements.md).
- [Reusing PostgreSQL date and time fields](types/decoding-dates.md).
- [Hex of `bytea` converted by the runtime](types/hex-of-bytea.md): by the native hex methods of `Uint8Array`, or by `Buffer` where the runtime lacks them, rather than by a loop of JavaScript, by `Buffer` alone, or by `Buffer` writing into the result without a copy.

## Tables and schemas

- [Column naming conventions of the table factory](schemas/column-naming-conventions.md).
- [Read-only view descriptors](schemas/read-only-views.md): how the descriptor restricts writes and checks the database object.
- [Singleton tables](schemas/singleton-tables.md): an option of a table whose queries start as queries of its row.
- [Database of the current context](schemas/database-of-the-current-context.md): a function that returns the database, which a `Db` checks only in the callbacks of its own transactions and sessions, rather than in every transaction of the async context or not at all.
- [Backing of keys in the table check](schemas/backing-of-keys.md): rules of the inference of an arbiter of `ON CONFLICT` over `pg_index`, rather than planning the insert of each key.
- [Sequences in object parts of a schema](schemas/sequences-in-object-parts.md): the types read a part without sequences as its tables, rather than splitting the keys of every part, which makes TypeScript instantiate the queries of a `Db` again.
- [Entries of `AnyDb`](schemas/entries-of-any-db.md): dynamic lookup through the table and sequence descriptor maps.

## Transactions

- [Phase of a connection failure watched on every statement](transactions/connection-failure-phase.md): through a wrapper of the connection of a transaction, rather than a flag of the driver or the rejection of the callback.
- [Sessions for statements outside a transaction](transactions/sessions.md): a level on a reserved connection, rather than a transaction that holds a lock beside the pool or access to the driver.
- [Open sessions shared by the callbacks of `run`](transactions/open-sessions.md): callbacks that join the session through the async context, a closing that waits for them, and that the database waits for, rather than statements and locks as methods of the session, a pending callback of `session`, a closing that ends the session at once, or sessions that the database closes.
- [External transactions as a level of the coordinator](transactions/external-transactions.md): a level over the connection of a transaction that other code owns, by the contract of a driver, rather than a driver that drops `BEGIN` and `COMMIT`, a target of its own in the migrator, a database of the transaction alone, or the query executor of the owner.
- [A thenable of a callback resolved in its level](transactions/thenables-of-callbacks.md): a query that a callback returns without awaiting it runs in the level, rather than rejecting the result, awaiting it outside the level, or wrapping every callback in an async function.
- [Callbacks of levels typed by `PromiseLike`](transactions/callback-types.md): a callback returns a bound query or another `PromiseLike` directly; the decision compares taking a value too, requiring a promise, and a thenable type of its own that costs less to check.
- [Levels of the test helpers that take turns on their connection](transactions/test-levels-that-take-turns.md): the transactions of the tested code one at a time and each statement outside a transaction in a savepoint of its own, rather than rejecting beside a running transaction, a turn for a whole request of a browser test, statements without savepoints, or truncating tables between browser tests.
- [Orchid transactions as a facade over Kern](transactions/orchid-adapter.md): per-instance state projection and one transaction owner instead of independent Orchid bookkeeping.
- [Transaction control in Orchid SQL rejected by its leading keywords](transactions/orchid-transaction-control.md): in the adapter before the statement runs, rather than unchecked, detected after it, or checked by kern-db for every statement.

## Drivers

- [Result columns as metadata objects](drivers/result-type-oids.md): names and required PostgreSQL type OIDs together, with values kept as text.
- [Converting postgres.js raw rows as they arrive](drivers/postgres-js-row-conversion.md): retaining text rows without collecting all raw buffers.
- [Errors of drivers recognized by `instanceof`](drivers/error-recognition.md): the classes recognize the errors of another copy of `kern-db` by a brand, rather than by predicates.
- [Error classes of `kern-db` in drivers](drivers/error-classes-of-kern-db.md): every driver rejects with them, and a custom driver imports them at runtime, rather than define classes of its own.
- [Release decided by the driver](drivers/release-by-driver.md): by what the driver saw on the connection and the status of its transaction, rather than by a failure that the caller passes.
- [Drivers recognized by their methods, databases by a brand](drivers/recognizing-drivers-and-databases.md): `isDriver` accepts a driver written by hand, and `isDatabase` only a database of `createDatabase`, of any copy of `kern-db`.
- [`QueryError` told by the conditions of PostgreSQL](drivers/error-conditions.md): one predicate of every condition by its name, without a constraint argument, rather than a predicate of each condition, constants of the codes, or a member of `QueryError`.
- [Native parameters of the postgres.js driver](drivers/native-parameters.md): an option of the built-in driver that returns the values of a statement that postgres.js serializes, rather than a driver of the Orchid adapter, a field of every statement that every driver honors, or exported parts of the driver.
- [Orchid values serialized by postgres.js](drivers/orchid-values.md): JavaScript values in a field of the statement, rather than an operation of kern-db that encodes by the server types with a patch of postgres.js.
- [Reusing Orchid's postgres.js codecs](drivers/orchid-codecs.md): the configured registries of the client, rather than handwritten codecs.
- [Text results of Bun SQL](drivers/bun-sql-results.md): raw fields of unnamed statements preserve text that native decoding can lose.

## Migrations

- [Capabilities the migrator does not add](migrations/migrator-scope.md).
- [Changes in a transaction beside those outside one](migrations/transactional-form.md): a step keeps `up` and `down` for a transaction block, rather than a call there rejecting the migration.
- [One step outside a transaction without records of progress](migrations/outside-transaction-step.md): a change that is safe to run again, rather than several steps or a record of the steps done.
- [Polling for the lock of a target outside a transaction](migrations/polling-for-the-lock.md): rather than waiting in `pg_advisory_lock` or rejecting.
- [Rejecting a call in a transaction at a stricter isolation level](migrations/strict-isolation-in-a-transaction.md): when it has migrations to run, rather than running from the snapshot, detecting a change since it, or rejecting also a target that is up to date.
- [A valid index of the name counts as built](migrations/valid-index-counts-as-built.md): `createIndex` with `concurrently` completes a migration whose record failed, rather than failing on the index, keeping it with `IF NOT EXISTS`, or building it again.
- [Rollback of `replaceView` chosen by an option](migrations/view-rollback-option.md): `rollback: "recreate"` for a change that cannot be replaced back, rather than detecting it when rollback runs.
- [Parameters of a function by name](migrations/function-parameters-by-name.md): a default and a mode as properties of an object, rather than a SQL string of the parameter that the helper reads, dropping by the name alone, or an option of defaults.
- [`replaceFunction` as a helper of its own](migrations/replace-function-helper.md): rather than an option of `createFunction`, such as `replace: true`, whose rollback would drop the function.
- [The temporary schema last in the search path of migrations](migrations/temporary-schema-last.md): a temporary table of the session does not take the place of a table of the target schema, at the cost of `pg_temp` as the schema that a statement with no other schema creates in.
- [A partitioned table indexed by a step of its own](migrations/concurrent-index-of-partitioned-table.md): `concurrently` leaves PostgreSQL to reject a partitioned table, rather than indexing each partition or building without `CONCURRENTLY`.

## Packages

- [The database layer as the package `kern-db`](packages/database-package.md): a package of one repository with the drivers as its subpaths, a public entry point for query builders on top of it, a regular dependency of `kern-orm`, a peer dependency of the migrator, and ranges of one minor line.

## Writing a decision

- Write each decision in a file of its own under its topic directory, such as `decisions/nested-rows/`, and list it in that topic's section of this index; add a topic only when none fits.
- Write in it the chosen design, the alternatives it weighs, their measured costs, and the other projects that chose an alternative.
- Mention another project only when its design is an alternative that the decision weighs, and name it as [comparison/README.md](../comparison/README.md#writing-a-record) describes.
- Add readable code examples where they make the designs easier to compare, such as the calls that users write or the SQL that the compiler builds.
- Record the ratios and counts that a decision relies on rather than absolute times, measured for a decision made for speed or size by a benchmark that [development/benchmarks.md](../development/benchmarks.md) describes.
- Link a decision from the contract of its design in architecture/, and keep there only that design and a reason of one clause; do not link decisions/ back to architecture/.
- In a comment beside the code of a decision, state its reason, with a measurement only when the reason rests on it, such as a cost of an order of magnitude rather than of a few percent.
