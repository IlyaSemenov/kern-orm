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

The entries of a `Db` are specialized `SelectQuery<S, "bound">` values, whose states differ by the schema contexts of a composed schema and one of its included schemas.
TypeScript 6 measures the state parameter as invariant (unreliable) and the kind parameter as bivariant (unreliable), so comparing two `Db` types can compare every query method for every shared table.
The first `DbOf` assignment in `benchmarks/types/first-use.bench.ts` costs 65929 instantiations for two shared tables, and an existing 12-table probe costs about 370 thousand.

- `where` prevents `out S` through the `WhereFilter<S["table"]>` parameter: its union of object conditions and callbacks includes mapped column values, `IsAny`, and a conditional null check.
- `orderBy(...keys)` prevents it through `OrderKey<S["table"]>`, a union of column keys and a mapped object of directions.
- The `select("*")` and `select(...keys)` overloads prevent it through the return state's `MergeSelection`, `Selectable`, and `Pick`, with the key constraint depending on `S["table"]`.
- The callback overload of `select` also has a recursive `this: SelectQuery<S, Kind>` constraint and callback references depending on both `ColumnRefs<S["table"]>` and `RelationRefs<S["schema"]>`.
- `take`, both overloads of `get`, and both overloads of `pluck` prevent it through `ChangeState` and the conditional row mappings `OneRow`, `OneValueRows`, and `ValueRows`; the keyed overloads also index `Selectable<S["table"]>` by a key constrained by the table.
- The other tested members do not individually reject `out S` in an isolated TypeScript 5.8.3 model, and `out Kind` passes there, but this is not a measurement of the actual declarations under TypeScript 6 or 7.

A generic `where<F extends WhereFilter<S["table"]>>` can evade the variance error, but it accepts an object containing a valid column and a misspelled column, so it is not an acceptable rewrite.
`NoInfer` on the original parameter does not remove the variance error, and alternate conditional or lookup representations of `OneRow` do not remove the `take` error in the same model.

Two designs remain candidates:

- A state-independent query-method base declares methods generic in their receiver state, such as `where<Q extends SelectQueryState>(this: QueryOfState<Q>, filter: WhereFilter<NoInfer<Q["table"]>>)`, and `SelectQuery<S, Kind>` retains its state only in covariant members.
- A narrower `Db`-entry facade combines branded `QueryOfState<S>` with a state-independent generic method surface, leaving the concrete `SelectQuery` class unchanged; it must preserve every query method and remain usable wherever the existing query type is required.

A synthetic TypeScript 5.8.3 two-table and 12-table comparison, not using the repository's types, reduces the first-assignment deltas from 27452 and 153452 to 152 and 532 with the shared-method base, and to 555 and 2915 with the entry facade.
These numbers are not `bench:types` counts, and the repository type tests, TypeScript 6/7 variances, and 12-table repository probe have not been verified with either candidate.

Keep production types unchanged until a candidate passes every `*.type-test.ts` under `bun check`, including excess-property checks and `DbOf` assignability, and its effect on every `bench:types` count and both sizes of the `DbOf` comparison is measured.
Prefer testing the `Db`-entry facade first because it changes a smaller surface, but keep the shared-method base available if the facade cannot preserve the public query contract.

Done when a composed `Db` fits the `DbOf` of each included schema without member-by-member query comparison, with the full type tests passing and measured lower cold costs on both schema sizes.
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
