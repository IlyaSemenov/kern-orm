# Queries

- **Query** (`query/`): immutable query object wrapping a semantic query node (`query/node.ts`), whose fields are expressions or the rows of nested queries.
  Its type carries one state object of its table, the schema context of its relations, the record or value of its rows, its result mode, and the relations whose records it and its nested queries select; a method replaces only its own parts, so new state is a new part rather than a new type parameter.
  The schema context is the relations of the schema the query starts from, by table key, and the key of its table there, so the same table queried from schemas of different relations gives different types.
  A query of `from(table)`, and of a table without relations in its schema, has the context without relations, and a query whose table has relations is also a query of the same table without them in types.
  At runtime, a query holds the context of its table in the schema or `Db` it starts from, which each of them creates once for each of its tables, whose relations the references of `select` start; a query of `from(table)` holds the context without relations.
  A query is covariant in its state and its kind, as `out` declares on `SelectQuery` and TypeScript checks: its methods take the query they are called on from `this`, and only `toSQL` reads the kind of the class, so that comparing two queries of different states, such as the entries of two `Db` types or a query passed to `$execute`, compares their states rather than their methods.
  Methods typed by the parameters of the class make TypeScript measure a query as invariant in its state, unreliably, and compare queries of different states member by member, which takes about 50 times the instantiations for the first comparison of two `Db` types of 2 shared tables and 200 times of 12 ([benchmark](../benchmarks/types/first-use.bench.ts)); inferring the query from `this` adds about 30 instantiations to each call of `where`.
  - The methods that keep the state in types, `where`, `orderBy`, `limit`, and `offset`, and `use`, which returns the query of its callback, take the whole query, so that they also apply to a union of queries.
  - A method that changes the state takes the state and the kind of the query, which TypeScript cannot infer from a union of queries of different states, so such a union rejects it.
    Two designs would apply such a method to a union of queries too, and both cost more than the contract is worth:
    - The method takes the whole query and returns a distributive conditional type of it, such as `Q extends SelectQuery<infer S, infer Kind> ? SelectQuery<ChangeState<S, …>, Kind> : never`.
      Each query then takes ~10% to ~70% more instantiations, such as ~65% more for `find` and `findBy` and ~25% more for a query of `where`, `select`, and `take` executed by `$execute`, and ~35% more for each further copy of that query ([benchmark](../benchmarks/types/queries.bench.ts)).
    - Each overload of the method is followed by a fallback overload of that form, which TypeScript tries only when the overload does not apply, such as on a union.
      A probe of `take` kept the cost of an ordinary query, but the fallbacks double the overloads of `select`, `get`, and `pluck` that declarations and editors show, and a call that matches no overload also reports the errors of the fallbacks, or only that of the last one, which is a fallback.
  - A parameter that takes queries of other states, such as of `$execute`, `$compile`, and `defineHelper`, and a nested query of a selection are typed by `SelectQuery` of either kind; a copy of a query made by spread or rest lacks its methods, so it is not a query.

Queries come in two kinds that share the query methods and differ only by execution context:

- An unbound query starts from a schema, needs no database connection, and can be defined at module level.
  A `Db` can execute it with `$execute` if its schema contains the tables and the selected relations of the query and every bound nested query belongs to that `Db`.
- A bound query starts from a `Db` and executes there when awaited or nested in a query that the same `Db` runs; its methods return queries bound to the same `Db`.

## Query objects

- Reusable query nodes hold no connection, transaction, or per-execution state.
- Nodes, queries, and their nested objects, such as query filters and column attributes, are frozen.
  Arrays of nodes, such as operands and projections, are immutable only by their `readonly` types: freezing an array in Bun 1.4.4 costs about 180 ns and makes iterating it about 30 times slower, on every query built and compiled.
  Parameter nodes hold their values by reference and encode them on every compilation.
  `where` reads the keys and values of an object of column values when it is called; a condition built in advance holds its objects by reference until then.
  A `Db` copies its bind options when it is bound.
- Only a bound query has a callable `then`, at runtime as well as in types, so returning an unbound query from an async function never executes it.
  A query of either kind may execute, so awaiting it or returning it from an async function is a type error.
  Its `then` may be `undefined`, so `Promise.resolve`, `Promise.all`, and a `then` callback that returns it type their result as the query itself even when it executes; `$execute` executes it.
- One class serves both kinds of queries: the members that differ by kind, `then`, `db`, and the options of `toSQL`, are typed by the kind parameter rather than declared by a subclass, so a query of either kind is one type whose overloaded methods TypeScript can call, and a function generic over the kind keeps it.
  Methods take the kind from the query they are called on, so they apply to a union of a bound and an unbound query of one state, such as of a conditional expression, and a method that changes the state gives a query of either kind.

## Selection

- A query returns only explicitly selected fields: without `select` its records have no fields, and all columns require `select("*")`.
- A selected field is a projection: an expression, the key of the field, and the type of the expression, which decodes its values; the projections are the result fields of the compiled query.
  A projection of nested rows has the result plan of their query instead of a type.
  An expression without a type, such as `sql<T>`, cannot be selected, since a TypeScript type does not determine how to decode its values; it is rejected at runtime by its missing type and in types by the mark of `TypedExpression`, which selection requires, `Expression` includes, and `AnyExpression`, such as an operand of a generic operator, lacks.
- Each `select` appends projections under new keys and replaces projections under existing keys without moving them; the same expression can be selected under several keys.
  The last selection of a key determines both its expression and its decoding type, so each key has one projection and repeating a column is idempotent, within a call as well as across calls.
  Result types merge fields by replacing overlapping keys, independently for each branch of a union of records or selections; a result of `any` stays `any`.
  Numeric keys are normalized to strings before merging, matching JavaScript object keys.
  An optional selection retains the input field's requiredness and allows either its previous value or the selected property value, including `undefined`.
  `clearSelect` removes all projections and keeps the other clauses.
  Outside helper callbacks, TypeScript can reduce a union to a query of fewer fields when the shared fields have compatible types and the other state parts match; selecting a key hidden by that reduction replaces its runtime projection.
- The key of a field names only the field of a record: `where`, `orderBy`, and column references resolve against the columns of their source, never against selected keys.

## Result modes

- The result mode of a query has two independent parts: its rows, which are `many` for an array, `one` for a row that must exist, `nullable` for a row that is `null` when missing, or `optional` for a row that is `undefined` when missing, and whether a row is the value of its only projection instead of a record.
  The same rows mode gives the same result to an executed query and to nested rows.
  `take`, `get`, and `pluck` keep `optional`, so `take().optional().get("a")` and `take().get("a").optional()` are the same query.
  - A query of a relation `many` starts with rows `many`, and of a relation `one` with rows `one` when the relation is required and `nullable` otherwise.
  - `take` turns `many` into `one` and adds `LIMIT 1`, keeping the offset and a limit of zero, so that `limit(0).take()` finds no row; a query of one row stays as it is.
  - `optional`, `nullable`, and `required` turn a query of one row into `optional`, `nullable`, and `one`, and reject a query of many rows.
  - The value of a missing row is never `null`, which would read as a `NULL` value: the method `nullable` rejects a query of values, and `get` and `pluck` turn rows `nullable` into `optional`.
  - `pluck` replaces the projections with one and makes the rows values, keeping the rows of the query apart from rows `nullable`; `get` is `pluck` followed by `take`.
  - `select` and `clearSelect` reject a query of values, at runtime as well as in types; `get` and `pluck` replace its projection.
  - The rows do not imply a limit: only the change from `many` to `one` adds `LIMIT 1`, since a relation `one` must detect several matches.
  - The result mode applies to an executed query and to packed nested rows; a query nested in a scalar subquery, `EXISTS`, or a derived source keeps only its SQL.
  - The result type of a query state is the union of the results of every mode it allows, such as of a union of rows modes or of states; `$execute` infers the whole query, so a union of queries gives the union of their results.

## Filters

- Objects of column values in `and`/`or`/`not` stay unresolved `values` nodes until `where` resolves them against its source; the compiler rejects an unresolved one.
- Query filters are kept as separate `relation`, `scope`, and `user` predicates combined with `AND` at compilation; `where` adds only to `user`, so a user `OR` never bypasses the relation filter ([orchid-orm#845](https://github.com/romeerez/orchid-orm/issues/845)).

## Finding by a key

- `find` and `findBy` are `where` of the values of a key followed by `take`, in one derived query, so they apply to a query of any rows, kind, and value, such as of a relation or after `pluck`: a query of many rows becomes a query of rows `one`, which rejects with `NotFoundError` without a row, and a query of one row keeps its rows mode, such as `optional`.
  - `find` takes the values of the primary key in the order of its columns, as `keys.primaryKey` of the table lists them; `findBy` takes an object of the columns of exactly one key, primary or unique, in any order.
  - A value is what `where` takes for its column, such as a column of the parent row of a nested query, but never `null` or `undefined`, even where the `eq` operator of the column takes them: the columns of a unique key may be nullable, and `IS NULL` matches several records.
  - `findBy` reads the keys and values of its object when it is called, into an object of column values of its own.
- Types read the keys from `TableKeys`, as `IsKey` does.
  - `find` takes values of type `never` on a table whose type tells no primary key, such as a table without one or a table typed as `Table<Name, Columns>`.
  - `findBy` infers the columns of its object and checks them with `IsKey`, with an error at the call; a union of objects of the keys would accept the columns of two keys together.
    It takes only the keys that the type of the table tells, and any columns on a table of `any`, such as of `AnySelectQuery`.
- At runtime, `find` rejects a table without a primary key and a number of values other than the number of its columns, `findBy` rejects columns that `isKey` does not take for a key, and both reject `null` and `undefined`.

## Sorting and pagination

- `orderBy` adds sort keys after those of earlier calls, and applies to a query of any rows: sorting a query of one row is the same as sorting it before `take`.
  - A string names a column, sorted in ascending order, and an object gives columns with their directions in the order of its keys, which JavaScript gives to integer-like keys first.
  - A direction is `asc` or `desc`, optionally followed by `nulls first` or `nulls last`, in lower case.
    The columns and directions of an object are checked at runtime too, since TypeScript accepts a computed key of type `string` as any column.
  - The callback returns a sort key or an array of them: an expression, sorted in ascending order, or an `Ordering` made by `asc`, `desc`, or `orderBy`, which its class tells apart from an expression.
    An expression without a type sorts too, since sort keys are never decoded.
  - The second parameter of the callback holds expressions over the nodes of the projections selected when `orderBy` is called, so a sort key of a selected field is its projection; a later selection that replaces the field leaves the order on the old expression.
    A field of nested rows throws when it is read: nested rows are JSON, which PostgreSQL cannot sort by, and types do not tell them from expressions.
    A query of values gets the expression of its value from another overload.
- `limit` and `offset` apply only to a query of many rows, in types and at runtime, since a query of one row must find a second row to reject it.
  A helper that paginates passes types when it is applied to a query of one row and fails at runtime, since its effect does not record pagination.
  Their counts are non-negative safe integers, sent as parameters; a later call replaces the earlier one.

## Nested queries and relations

- The references of the callback of `select` have the columns of the query source and the relations of its table in the schema context of the query, all as own enumerable properties, so returning or spreading them selects every field their type has; the callbacks of `where`, `get`, and `pluck` get only the columns.
  A relation gives an unbound query of its related records over a new occurrence of the target table, in the context of the target table in the same schema, even for a query of a `Db`.
  Its relation filter compares the columns of the keys with SQL `=` in order, built from SQL nodes rather than by calling the `eq` operators of their types.
  In types, a schema context whose table key is `string`, such as that of the queries a `Db` accepts, has no relations, since queries of relations there would keep the queries of a `Db` from being assigned to them.
- A selected field is an expression with a type or a query of either kind, whose rows become the value of the field.
  A nested query bound to a `Db` runs only in a statement of the same `Db`, since the statement takes the options of its `Db`, such as the PostgreSQL schema; lowering checks the `Db` by identity at any depth, and types do not check it.
  Nested rows are the result that their query would give when executed; the state of the nested query adds the relations it selects to the state of the parent.

## Queries of a Db

- A `Db` rejects a query bound to another `Db`.
- A `Db` compiles a statement with the tables of its schema, and the compiler rejects an occurrence of any other table at any depth of the statement, such as in a scalar subquery, `EXISTS`, a join, or a derived source, when it compiles the occurrence.
- A `Db` compiles a query with the relation definitions of its schema, and lowering rejects a query of any other definition at any depth, by identity rather than by name, so a relation that another schema declares with the same name and keys is rejected, while a tenant schema adds relations of its own and keeps the shared ones.
  In types, `$compile` and `$execute` reject a query whose state selects a relation that the relations of the `Db` lack by table key, name, kind, target, and `required`; types cannot tell two definitions of the same shape apart.
  The relations of a query only accumulate in its state: `clearSelect`, `get`, `pluck`, and replacing a field keep them in types after the runtime drops their nested queries, which never under-approximates the relations a query needs.
  An awaited query of a `Db` is checked only at runtime: the references of its `select` give the relations of the `Db`, but a nested query of another schema can select others.

## Helpers

- `use` returns the query of its callback, which must have the source occurrence of the query the callback receives at runtime and its kind in types, so the query `use` is called on sets the binding.
  The check does not tell a derived query from an ancestor, which drops the clauses added after it.
  Branches of a callback that leave different states give a union of queries, which takes the methods that keep the state, such as `where` and `orderBy`, but not those that change it, such as `select` and `take`, unless TypeScript reduces the union to a query of fewer fields.
- The callback of a helper of `defineHelper` receives a query of either kind whose result is a marker record, and the effect of the helper is read from the query it returns: the fields selected beside the marker, and the rows mode, `one` after `take` or `required`, and `nullable` or `optional` after the method of the same name.
  - The effect records only the rows mode that the callback ends with: `required` is typed as `take`, so a query of one row keeps its rows mode in types while the helper makes it `one`, and a helper that calls `nullable` before `optional` or `required` passes types on a query of values and fails at runtime.
  - The marker starts with no selected keys and accumulates their union on every selection, including through another helper.
    The marker prevents a branch selecting extra keys from being reduced to one selecting fewer fields or none, preserving possible overwrites of input fields.
  - The public type of a helper holds the selected fields without the marker, so that the declarations of a module exporting a helper never name it.
  - Every branch of a helper must retain the marker and remain a record query; `clearSelect`, `get`, and `pluck` are rejected because its effect cannot describe the discarded input fields.
  - A helper adds or replaces fields by the same merge as `select`, for every branch of its effect; a query of values rejects a helper that selects fields or ends with a call of `nullable` in any branch.
  - A helper checks that its callback returns the input query or one derived from it, also when called directly.
    The returned query keeps the kind and the `Db` of the input query.
- The callback of a helper defined with a query of a schema or a `Db` receives a query of its schema context in types, and at runtime the query it is applied to, whose schema shares the definitions of the relations by identity when it includes that schema.
  The callback reads relations by name from the query it is applied to, so applying a helper that selects relations of its schema context requires a query of its table under the same key with those relations, also when it is called directly.
  Relations of other schemas, such as of an independent query that the helper nests, stay in the state of the result for the `Db` to check; a helper defined with a table reads no relations.
- A helper checks the query it is applied to by the constraint of its state rather than by a conditional type: TypeScript defers a conditional type of a generic state and accepts a query for it only when the query fits both branches, one of which is the error.
  So a function generic over the state applies every helper that the constraint of its state allows: one that selects fields or ends with `nullable` when the constraint has `value: false`, and one that reads relations when the constraint has a schema context with them.
  The constraint of `value` is `false` or the error that names what the helper cannot do, so that the error of a query of values names it; for a missing relation, TypeScript names the relation itself.

## Decisions

These hold for features that are not implemented yet.

- Scope predicates are never operands of a user `OR` ([orchid-orm#845](https://github.com/romeerez/orchid-orm/issues/845)).
- Entry points of singleton tables start queries of one row, so `optional`, `nullable`, and `required` apply to them.

## Open questions

- `where` predicates with joins: which source objects of column values resolve against, whether they can address joined tables, and how a callback receives the columns of joined tables.
  `SelectQuery` is typed by a single table and will need the shape of all query sources.
  A column of a source joined with `LEFT JOIN` is `NULL` without a match whatever its type, so its result type needs the nullability of the join.
