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

## Tables and schemas

- [Column naming conventions of the table factory](schemas/column-naming-conventions.md).

## Migrations

- [Capabilities the migrator does not add](migrations/migrator-scope.md).
