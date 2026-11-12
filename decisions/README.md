# Decisions

Trade-offs between designs of kern-orm: what each decision chose, the alternatives it weighed, their measured costs, and the other projects that chose an alternative.
Architecture states the chosen designs and links each decision from the contract of its design.

## Queries

Query objects, their types, and the methods that choose rows.

- [Query methods typed by `this`](queries/query-methods-typed-by-this.md): a query is covariant in its state, so comparing queries compares states.
- [State-changing methods on unions of queries](queries/state-changing-methods-on-unions.md): a union of queries of different states rejects them.
- [Query classes without a base class](queries/query-classes-without-base-class.md): each class repeats a few declarations.
- [Row locks rejected by the state in types](queries/row-lock-state.md).
- [Relations in the references of callbacks](queries/relations-in-callbacks.md).
- [One parameter of `$execute` for every class of query](queries/execute-parameter.md).
- [Arrays of nodes not frozen](queries/unfrozen-node-arrays.md).

## Filters and expressions

Filters, queries in expressions, and SQL fragments.

- [Filter of `where` as a conditional type](expressions/where-filter-type.md): it types literals of a callback by their columns.
- [One signature of `in`](expressions/in-signature.md).
- [`expr` of a query of one value](expressions/expr-of-queries.md): the operators of a query value come from an expression, not from methods of the query.
- [The `valueType` part of the state](expressions/value-type-part.md).
- [`identifier` as a function of its own](expressions/identifier-function.md).
- [`matches` checks its object by its own keys](expressions/matches-checks-own-keys.md).
- [Recognizing an operand by one lookup](expressions/operand-recognition.md).
- [Operand of an object condition read from the column type](expressions/object-condition-operand.md).

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

## Queries of SQL text

- [Columns of SQL text checked after the statement](sql-queries/columns-of-sql-text.md).

## SQL generation

Lowering and the statements that the compiler builds, apart from nested rows.

- [Lowering visits every node](sql/lowering-visits-every-node.md).
- [Parameters bound once only in queries of groups](sql/parameters-of-groups.md).

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

## Tables and schemas

- [Column naming conventions of the table factory](schemas/column-naming-conventions.md).
- [Singleton tables](schemas/singleton-tables.md): an option of a table whose queries start as queries of its row.

## Transactions

- [Phase of a connection failure watched on every statement](transactions/connection-failure-phase.md): through a wrapper of the connection of a transaction, rather than a flag of the driver or the rejection of the callback.
- [Sessions for statements outside a transaction](transactions/sessions.md): a level on a reserved connection, rather than a transaction that holds a lock beside the pool or access to the driver.
- [Requests of an open test transaction that take turns on its connection](transactions/open-test-transactions.md): its transactions one at a time and each statement outside a transaction in a savepoint of its own, rather than rejecting beside a running transaction, a turn for a whole request, statements without savepoints, or truncating tables between tests.

## Drivers

- [Errors of drivers recognized by `instanceof`](drivers/error-recognition.md): the classes recognize the errors of another copy of `kern-db` by a brand, rather than by predicates.
- [Error classes of `kern-db` in drivers](drivers/error-classes-of-kern-db.md): every driver rejects with them, and a custom driver imports them at runtime, rather than define classes of its own.
- [Release decided by the driver](drivers/release-by-driver.md): by what the driver saw on the connection and the status of its transaction, rather than by a failure that the caller passes.
- [Drivers recognized by their methods, databases by a brand](drivers/recognizing-drivers-and-databases.md): `isDriver` accepts a driver written by hand, and `isDatabase` only a database of `createDatabase`, of any copy of `kern-db`.
- [`QueryError` told by the conditions of PostgreSQL](drivers/error-conditions.md): one predicate of every condition by its name, without a constraint argument, rather than a predicate of each condition, constants of the codes, or a member of `QueryError`.

## Migrations

- [Capabilities the migrator does not add](migrations/migrator-scope.md).
- [Changes in a transaction beside those outside one](migrations/transactional-form.md): a step keeps `up` and `down` for a transaction block, rather than a call there rejecting the migration.
- [One step outside a transaction without records of progress](migrations/outside-transaction-step.md): a change that is safe to run again, rather than several steps or a record of the steps done.
- [Polling for the lock of a target outside a transaction](migrations/polling-for-the-lock.md): rather than waiting in `pg_advisory_lock` or rejecting.
- [Rejecting a call in a transaction at a stricter isolation level](migrations/strict-isolation-in-a-transaction.md): when it has migrations to run, rather than running from the snapshot, detecting a change since it, or rejecting also a target that is up to date.
- [A valid index of the name counts as built](migrations/valid-index-counts-as-built.md): `createIndex` with `concurrently` completes a migration whose record failed, rather than failing on the index, keeping it with `IF NOT EXISTS`, or building it again.
- [A partitioned table indexed by a step of its own](migrations/concurrent-index-of-partitioned-table.md): `concurrently` leaves PostgreSQL to reject a partitioned table, rather than indexing each partition or building without `CONCURRENTLY`.

## Packages

- [The database layer as the package `kern-db`](packages/database-package.md): a package of one repository with the drivers as its subpaths, a public entry point for query builders on top of it, a regular dependency of `kern-orm`, a peer dependency of the migrator, and ranges of one minor line.
