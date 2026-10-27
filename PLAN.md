# Plan

Working notes on pending work, not a specification: change items, their order, and proposed designs whenever the work suggests better ones.
Items are unnumbered and listed in the suggested order; "Later" collects ideas without an order.

Orchid issues to keep in mind for relations:

- Correlation is lost or points to the wrong source: [#855](https://github.com/romeerez/orchid-orm/issues/855), [#851](https://github.com/romeerez/orchid-orm/issues/851).
- A user `OR` bypasses the relation predicate: [#845](https://github.com/romeerez/orchid-orm/issues/845).
- Nested results confuse a missing record, `null`, and an empty array: [#830](https://github.com/romeerez/orchid-orm/issues/830).
- Repeated selections and colliding names break decoding and types: [#792](https://github.com/romeerez/orchid-orm/issues/792), [#790](https://github.com/romeerez/orchid-orm/issues/790).

## Filters of a required relation

A query of a required relation `one` keeps rows `one` after `where`, so a filter that excludes the related record, such as `field.form.where({ published: true })`, rejects the whole query for a field of an unpublished form; `docs/queries/relations.md` tells users to add `nullable` or `optional`.
A scope, such as soft delete, will exclude records the same way.

- Weigh `where`, and a scope, turning a query of a required relation into `nullable`, or into `optional` for a query of values of `get` and `pluck`, whose missing row is never `null`, against keeping the rows and the instruction of the documentation.
- A query of `take` keeps rows `one` after `where`, since it asks for a row that must exist; types cannot tell it from a query of a required relation without a new part of the query state, whose cost `bench:types` measures.

Done when the contract of `where` and scopes on a query of a required relation is decided and documented, with paired tests of filters before and after `get` and `pluck`.

## `$select`

Select independent queries and expressions in one statement as one record, like `db.$select` of Orchid ORM, such as the forms and the number of users of a page.
It reuses the nested rows of unbound queries; a query without a table needs a semantic node without a source, which lowers to a statement without `FROM`.

## Acceptance matrix

Add checks along the relation work and collect them here before extending the API:

- three levels of nesting and two sibling collections;
- a self-relation and two relations to the same table;
- composite and nullable keys;
- table names and field keys of 63 bytes and more;
- a shared query moved between tenant and SaaS bindings;
- tenant-only relations absent from the SaaS API;
- reuse and independent refinement of queries;
- execution inside an ambient transaction;
- inference accuracy and typecheck cost on a moderately deep graph;
- `EXPLAIN ANALYZE` with realistic fan-out and pagination: rows processed, index use, and the placement of limits, without snapshots of exact plans.

## postgres.js 4

Move `@kern-orm/postgres-js` to postgres.js 4 and drop 3.x.
Version 4 rewrites everything below the public API, and its changelog describes fixes for the problems the driver works around, without naming their issues.

- Keep sending parameters with OID 705 (`unknown`) and reading the bytes of text-format results through `.raw()`; such parameters need no separate describe round trip.
- Check each workaround for 3.4.9 with a test before removing it: connections kept reserved after a failed end of a transaction, `closeTimeout`, and `endFailedTransaction`.
- Check the new behavior of a reserved connection released with its own `BEGIN` still open, which version 4 closes.
- Rewrite the [open questions](architecture/drivers.md#open-questions) on connection loss, `sql.end()`, and `fetch_types: false` based on the test results.
- Decide whether statements of a closed level are cancelled with `.signal()` of a query, which the next item and the open question on test timeouts depend on.

Done when the driver tests pass on version 4 and every remaining workaround has a failing upstream case.

## Abort signal of a test

Add an optional `signal` to `testTransaction`, such as the test signal of `node:test` and Vitest, so that a test the runner gave up on stops holding its level.
`bun:test` has no signal for each test, so it keeps relying on preemption.

- Aborted before the level starts, including while waiting in the queue of the fixture stack or for a connection: the callback never runs, and a connection acquired late is released.
- Aborted while `BEGIN` or `SAVEPOINT` runs: the level ends once it completes, without running the callback.
- Aborted while the callback runs: the level stops accepting statements at once and ends without waiting for the callback, as closing a fixture does with its seed; the late errors of the callback stay handled.
- A statement already sent completes before the rollback; the signal does not cancel it.

Done when an aborted test transaction, with or without a fixture, releases its savepoint or connection while its callback never settles, and a test transaction aborted in the queue never calls its callback.

## Later

- Relation `EXISTS` and aggregates.
  An aggregate of related records, such as their count, is an expression rather than nested rows, so that `orderBy` sorts by it through the selected fields.
- Keyset pagination: pages after the sort keys of the last row of the previous page, reading the order of a query, which its node keeps as expressions with directions; how code outside kern-orm reads the order is not designed.
- Through and many-to-many relations.
- To think about: an error that names the field when a relation `one` finds several records, such as where the database lacks a key that its table declares, instead of the SQLSTATE `21000` of PostgreSQL, such as by `LIMIT 2` and a check in decoding; measure its cost first.
- Sorting by a field of the related record of a relation `one`, such as fields by the name of their form; keep the design of sorting and relations open to it.
- Helper effects that record the calls of their callbacks rather than only the rows mode they end with, so that types check what the runtime checks and the limitations that [architecture/queries.md](architecture/queries.md#helpers) states for helpers go away:
  - a query of one row rejects a helper that calls `limit` or `offset`;
  - the effect applies the calls that change the rows in their order, also in a helper that it applies, so that a helper whose last such call is `required` makes a query of one row `one` in types, as it does at runtime;
  - a query of values rejects a helper that calls `nullable` before `optional` or `required`, also when the call is in a helper that it applies.

  It needs a new part of the query state, so measure its cost with `bench:types` before choosing a design.

- Relation-aware mutations, as a separate project.
- Upserts take their conflict target from the keys of the table.
- Optional, research: a function that types a union of queries of several tables or kinds, such as `cond ? db.foo : db.bar`, as one query whose overloaded methods TypeScript can call, while a query of one table keeps its plain types.
  - At runtime it returns its argument: methods resolve columns by name in the table of the chosen query.
  - Its table has the columns that every table has with the same type; a column of the same name and another type, a filter of `defineFilter`, and a relation of one table are unavailable.
  - Its result and rows mode are the unions of those of the queries, and its kind is bound or unbound when every query is, and either kind otherwise.
  - The state keeps the source tables as a new part, so that a `Db` still checks them against its schema.
  - Check first whether a union of tables in the state, `SelectQuery<InitialQueryState<typeof foo | typeof bar>, Kind>`, already gives the common columns.
  - Branches of a callback of `use` or of a helper that leave different states could become one query of a union state the same way.
  - Alternatively, methods that change the state could apply to a union of queries by one of the designs that [architecture/queries.md](architecture/queries.md) weighs, at the costs it records.
