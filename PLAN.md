# Plan

Working notes on pending work, not a specification: change items, their order, and proposed designs whenever the work suggests better ones.
Items are unnumbered and listed in the suggested order; "Later" collects ideas without an order.

Orchid issues to keep in mind for relations:

- Correlation is lost or points to the wrong source: [#855](https://github.com/romeerez/orchid-orm/issues/855), [#851](https://github.com/romeerez/orchid-orm/issues/851).
- A user `OR` bypasses the relation predicate: [#845](https://github.com/romeerez/orchid-orm/issues/845).
- Nested results confuse a missing record, `null`, and an empty array: [#830](https://github.com/romeerez/orchid-orm/issues/830).
- Repeated selections and colliding names break decoding and types: [#792](https://github.com/romeerez/orchid-orm/issues/792), [#790](https://github.com/romeerez/orchid-orm/issues/790).

## `find` and `findBy`

Find a record by a key of its table, as Orchid ORM does, such as `db.user.find(id)`.

- `find(id)` and `find(userId, groupId)` take the values of the primary key in the order of its columns, which `keys.primaryKey` of the table and its type keep.
- `findBy({ email })` takes an object of the columns of one key, primary or unique.
- Both are methods of any query, like `take`, such as after `where`, `select`, or `pluck`, and of a query of a relation, such as `form.fields.find(fieldId)`.
- Each is `where` of the values followed by `take`, in one derived query, as `get` is `pluck` followed by `take`; so it rejects with `NotFoundError` without a row, and `optional`, `nullable`, and `required` apply.
- A value is what `where` accepts for its column, including an expression, such as a column of the parent row of a nested query, `schema.field.find(answer.fieldId)`.
- A value is never `null` or `undefined`: the columns of a unique key may be nullable, and `IS NULL` matches several records.
- Types read the keys from `TableKeys` by inference, as `IsKey` does; chains must not get more expensive.
  - A table whose type tells no primary key, such as a table without one or a table typed as `Table<Name, Columns>`, has no `find` in types, and `findBy` takes only the keys that the type tells.
  - `findBy` infers the columns of its object and checks them with `IsKey`, with an error at the call: a union of objects of the keys would accept the columns of two keys together, such as `{ email, id }`.
  - Export from the entry point the types that the signatures name.
- At runtime, both reject a table without a primary key, a number of values other than the number of its columns, `null` and `undefined`, and for `findBy`, columns that are not exactly a key, as `isKey` tells.
- Start after the diagnosis of what keeps `SelectQuery` from being covariant, in the item "Cheaper comparison of `Db` types": write the signatures in the shapes that it finds to keep covariance, or in those of `where` when it finds none.
- Benchmark `find` and `findBy` in `queries.bench.ts`, warmed up on another table; report the growth of "DbOf assignment", whose comparison of queries compares their new members too.
- Describe both in the section on one row of `docs/queries/selecting.md`, starting from getting a record by its key.

Done when both methods are typed by the keys of the table and reject other columns at runtime, with paired tests, benchmarks, and the user documentation.

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
- Rewrite the [open questions](ARCHITECTURE.md#open-questions) on connection loss, `sql.end()`, and `fetch_types: false` based on the test results.
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

## Cheaper comparison of `Db` types

The first comparison of two `Db` types, such as of a `Db` of a composed schema passed as a `DbOf` of an included one, compares their entries, queries of different states, member by member, once for each pair of `Db` types.
It takes about 30 thousand instantiations for each shared table on the schemas measured: 65929 for the 2 shared tables of the benchmark "DbOf assignment", and about 370 thousand for 12 shared tables in a probe outside the repository.

- TypeScript measures `SelectQuery` as invariant in its state, unreliably; a query that it measures as covariant would compare its state alone, and `QueryOfState` would no longer be needed.
- Check separately, on minimal pairs of states, what prevents covariance: `WhereValues`, whose conditionals on `IsAny` and `null` make a query over a specific table also a query over any table, `OrderKey`, and the key constraints of `select`, `get`, and `pluck`.
- Keep the checks that reject wrong filters, keys, and relations; an `out` annotation that TS2636 rejects is not a fix.
- Weigh also entries of a `Db` typed so that comparing two `Db` types compares no queries.

Done when comparing two `Db` types compares the states of their queries but not their methods, its cold cost drops measurably on a small and a large schema, both kept as benchmarks, and a `Db` of a composed schema fits a `DbOf` of every schema that it includes, as the type tests of `DbOf` check.

## Later

- Relation `EXISTS` and aggregates.
  An aggregate of related records, such as their count, is an expression rather than nested rows, so that `orderBy` sorts by it through the selected fields.
- Keyset pagination: pages after the sort keys of the last row of the previous page, reading the order of a query, which its node keeps as expressions with directions; how code outside kern-orm reads the order is not designed.
- Through and many-to-many relations.
- To think about: an error that names the field when a relation `one` finds several records, such as where the database lacks a key that its table declares, instead of the SQLSTATE `21000` of PostgreSQL, such as by `LIMIT 2` and a check in decoding; measure its cost first.
- Sorting by a field of the related record of a relation `one`, such as fields by the name of their form; keep the design of sorting and relations open to it.
- `required` of a relation `one` inferred as `false` for a target with soft delete, whose records a query may not find.
- Relation-aware mutations, as a separate project.
- Upserts take their conflict target from the keys of the table.
- A mode of `profile:types` for one-time costs, such as the first comparison of two `Db` types, which compares the file with and without the code, checked alone as Attest checks it, rather than copies of the code.
- Optional, research: a function that types a union of queries of several tables or kinds, such as `cond ? db.foo : db.bar`, as one query whose overloaded methods TypeScript can call, while a query of one table keeps its plain types.
  - At runtime it returns its argument: methods resolve columns by name in the table of the chosen query.
  - Its table has the columns that every table has with the same type; a column of the same name and another type, a filter of `defineFilter`, and a relation of one table are unavailable.
  - Its result and rows mode are the unions of those of the queries, and its kind is bound or unbound when every query is, and either kind otherwise; this also replaces the annotation that lets `cond ? db.post : schema.post` chain.
  - The state keeps the source tables as a new part, so that a `Db` still checks them against its schema.
  - Check first whether a union of tables in the state, `SelectQuery<InitialQueryState<typeof foo | typeof bar>, Kind>`, already gives the common columns.
  - Branches of a callback of `use` or of a helper that leave different states could become one query of a union state the same way.
