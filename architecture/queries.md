# Queries

- **Query** (`query/`): immutable query object wrapping a semantic query node (`query/node.ts`), whose fields are expressions, the rows of nested queries, or literals.
  Its type carries one state object of its table, the schema context of its relations, the record or value of its rows and the type of its value, its result mode, and the relations whose records it and its nested queries select; a method replaces only its own parts, so new state is a new part rather than a new type parameter.
  The schema context is the relations of the schema the query starts from, by table key, and the key of its table there, so the same table queried from schemas of different relations gives different types.
  A query of `from(table)`, and of a table without relations in its schema, has the context without relations, and a query whose table has relations is also a query of the same table without them in types.
  At runtime, a query holds the context of its table in the schema or `Db` it starts from, which each of them creates once for each of its tables, whose relations the references of `select` start; a query of `from(table)` holds the context without relations.
  A query is covariant in its state and its kind, as `out` declares on `SelectQuery` and TypeScript checks: its methods take the query they are called on from `this`, and only `toSQL` reads the kind of the class, so that comparing two queries of different states, such as the entries of two `Db` types or a query passed to `$execute`, compares their states rather than their methods.
  Methods typed by the parameters of the class make TypeScript measure a query as invariant in its state, unreliably, and compare queries of different states member by member, which takes about 50 times the instantiations for the first comparison of two `Db` types of 2 shared tables and 200 times of 12 ([benchmark](../benchmarks/types/first-use.bench.ts)); inferring the query from `this` adds about 30 instantiations to each call of `where`.
  - The methods that keep the state in types, `orderBy`, `limit`, `offset`, `where` of a query whose row is not guaranteed, and `use`, which returns the query of its callback, take the whole query, so that they also apply to a union of queries; `where` of a guaranteed query changes its state.
  - A method that changes the state takes the state and the kind of the query, which TypeScript cannot infer from a union of queries of different states, so such a union rejects it.
    Two designs would apply such a method to a union of queries too, and both cost more than the contract is worth:
    - The method takes the whole query and returns a distributive conditional type of it, such as `Q extends SelectQuery<infer S, infer Kind> ? SelectQuery<ChangeState<S, …>, Kind> : never`.
      Each query then takes ~10% to ~70% more instantiations, such as ~65% more for `find` and `findBy` and ~25% more for a query of `where`, `select`, and `take` executed by `$execute`, and ~35% more for each further copy of that query ([benchmark](../benchmarks/types/queries.bench.ts)).
    - Each overload of the method is followed by a fallback overload of that form, which TypeScript tries only when the overload does not apply, such as on a union.
      A probe of `take` kept the cost of an ordinary query, but the fallbacks double the overloads of `select`, `get`, and `pluck` that declarations and editors show, and a call that matches no overload also reports the errors of the fallbacks, or only that of the last one, which is a fallback.
  - A parameter that takes queries of other states, such as of `$execute`, `$compile`, and `defineHelper`, and a nested query of a selection are typed by `SelectQuery` of either kind, and those of `$execute` and `$compile` also by the `RecordQuery` of `$select`; a copy of a query made by spread or rest lacks its methods, so it is not a query.

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
- A selected field other than a literal is a projection: an expression, the key of the field, and the type of the expression, which decodes its values; the projections are the result fields of the compiled query.
  A projection of nested rows has the result plan of their query instead of a type.
  An expression without a type, such as `sql<T>`, cannot be selected, since a TypeScript type does not determine how to decode its values; it is rejected at runtime by its missing type and in types by the mark of `TypedExpression`, which selection requires, `Expression` includes, and `AnyExpression`, such as an operand of a generic operator, lacks.
- Each `select` appends fields under new keys and replaces fields under existing keys without moving them; the same expression can be selected under several keys.
  The last selection of a key determines the whole field, such as its expression and its decoding type, so each key has one field and repeating a column is idempotent, within a call as well as across calls.
  Result types merge fields by replacing overlapping keys, independently for each branch of a union of records or selections; a result of `any` stays `any`.
  Numeric keys are normalized to strings before merging, matching JavaScript object keys.
  An optional selection retains the input field's requiredness and allows either its previous value or the selected property value, including `undefined`.
  `clearSelect` removes all fields and keeps the other clauses.
  Outside helper callbacks, TypeScript can reduce a union to a query of fewer fields when the shared fields have compatible types and the other state parts match; selecting a key hidden by that reduction replaces its runtime field.
- The key of a field names only the field of a record: `where`, `orderBy`, and column references resolve against the columns of their source, never against selected keys.
- A literal (`query/literal.ts`) is a field whose value comes from code and never reaches PostgreSQL, unlike `param`: it has no projection, and its value is in the result plan ([SQL generation](sql.md#result-decoding)).
  Orchid ORM 0.73.36 `sql.val` instead sends the value as a parameter and reads back what the driver gives ([source](https://github.com/romeerez/orchid-orm/blob/main/packages/pqb/src/query/expressions/val-expression.ts)), so its value has to survive the round trip.
  - It is not an expression: types take it only in a selection, and at runtime it rejects as an operand, also as the value of a column of an unknown type, and `get`, `pluck`, and the aggregate methods reject it as their value.
  - Types keep the literal type of a primitive, such as `"none"`, so that a branch beside a column gives a union of its values, and leave objects and arrays mutable.
  - A selection holds it in place among its fields, so a later selection replaces it by key as any other field; reading it among the references of the callback of `orderBy` throws, as reading nested rows does, rather than dropping a sort key silently, and a query that selects a field conditionally must sort by it under the same condition.
  - Its record holds the value by reference, the same in every row.

## Result modes

- The result mode of a query has two independent parts: its rows, which are `many` for an array, `one` for a row that must exist, `nullable` for a row that is `null` when missing, or `optional` for a row that is `undefined` when missing, and whether a row is the value of its only projection instead of a record.
  The same rows mode gives the same result to an executed query and to nested rows.
  `take`, `get`, and `pluck` keep `optional`, so `take().optional().get("a")` and `take().get("a").optional()` are the same query.
  - A query of a relation `many` starts with rows `many`, and of a relation `one` with rows `one` when the relation is required and `nullable` otherwise.
  - The row of a query of a required relation is guaranteed, which the state of the query records apart from its rows mode.
    The relation guarantees only the record it relates, not one that also passes a filter, so `where`, `find`, and `findBy` end the guarantee and turn rows `one` of a guaranteed query into `nullable`, or `optional` for a query of values; `optional`, `nullable`, and `required` end it as well.
    So `field.form.where(...)` resolves to `null` without a matching record, while `required` before or after the filter keeps rows `one`.
  - A filter keeps the rows mode of a query whose row is not guaranteed, such as a query of `take` or `find`, which still rejects without a row: the order of `take`, `find`, and `where` never changes how a missing row is handled.
  - `take` turns `many` into `one` and adds `LIMIT 1`, keeping the offset and a limit of zero, so that `limit(0).take()` finds no row; a query of one row stays as it is.
  - `optional`, `nullable`, and `required` turn a query of one row into `optional`, `nullable`, and `one`, and reject a query of many rows.
  - The value of a missing row is never `null`, which would read as a `NULL` value: the method `nullable` rejects a query of values, and `get` and `pluck` turn rows `nullable` into `optional`.
  - `pluck` replaces the projections with one and makes the rows values, keeping the rows of the query apart from rows `nullable`; `get` is `pluck` followed by `take`.
  - `select` and `clearSelect` reject a query of values, at runtime as well as in types; `get` and `pluck` replace its projection, unless it is an aggregate query or a query of [`exists`](#exists).
  - The rows do not imply a limit: only `take` adds `LIMIT 1`, when it changes rows `many` to `one`, since a relation `one` and a query of `find` must detect several matches.
  - The result mode applies to an executed query and to packed nested rows; a query nested in a scalar subquery, `EXISTS`, a derived source, or SQL text keeps only its SQL.
  - The result type of a query state is the union of the results of every mode it allows, such as of a union of rows modes or of states; `$execute` infers the whole query, so a union of queries gives the union of their results.

## Filters

- Objects of column values in `and`/`or`/`not` stay unresolved `values` nodes until `where` resolves them against its source; the compiler rejects an unresolved one.
- Query filters are kept as separate `relation`, `scope`, and `user` predicates combined with `AND` at compilation; `where` adds only to `user`, so a user `OR` never bypasses the relation filter ([orchid-orm#845](https://github.com/romeerez/orchid-orm/issues/845)).
- A condition rejects, also at runtime, a value that is not an object of column values, such as `false` or an array, and an object without keys that is not plain, such as a `Date` or an instance whose values are getters: without keys it would read as an empty object, which is `TRUE`, and `where(false)` would select every row.
  An instance of a class with fields stays an object of column values, as types take it, since the compiler checks its keys against the columns, and an empty plain object, of any realm, stays `TRUE`.
- `where`, `and`, `or`, and `not` take a query of a table of one Boolean value as a condition, such as `not(form.fields.exists())`, as an expression takes it as an operand ([queries in expressions](#queries-in-expressions)).
  Only types check that the value is Boolean: at runtime, as for an expression, PostgreSQL rejects a predicate of another type, such as in `WHERE` or `NOT`.

## Queries in expressions

- An expression takes a query of a table of one value, such as of `get`, of an aggregate, or of [`exists`](#exists), wherever it takes an operand: as a condition, an operand of an operator, such as `field.position.lt(form.fields.max("position"))`, a value of an object condition, an item of the list of `in`, the fallback of `coalesce`, an operand of a [function of expressions](types.md#functions-of-expressions), and a value of `param` with an expression.
  A [sort key](#sorting-and-pagination) takes it too.
  A query of `exists` is `EXISTS` of its rows, and another query a scalar subquery of its value.
  - The query keeps its `Db`, which must be the `Db` that runs the statement, as for a nested query of a selection.
  - At runtime, it rejects the queries of a shape that types reject: a query of records or of rows `many`, and a query of `$select`, a mutation, and a query of SQL text.
    The modules of expressions recognize a query by the method of the symbol key `operandNode` of `expression/expression.ts`, which every class of queries has, since the queries import those modules; the method of `SelectQuery` returns the node of the query in an expression, and the others reject the query.
    An expression has the method too, so that `toValueNode` recognizes either by one lookup of the symbol, which it writes out rather than calling `isOperandSource`.
    Most values are neither, and the alternatives took longer to build a query of them on Bun 1.4.4 and Node.js 24.18 ([benchmark](../benchmarks/runtime/building.bench.ts)):
    - recognizing an expression by its class and then a query by the symbol, 4 to 8% longer for `in` of 1000 dates, and up to 3% for `in` of 1000 strings and an insert of 1000 records on Node.js;
    - calling `isOperandSource`, 6 to 8% longer for the dates and 2 to 3% for the others on Bun.
      Recognizing only an expression by its class, as without queries in expressions, is at most 2% faster, for the dates on Bun.
  - Types check the value of the query, as they check the values of an expression operand, rather than its SQL type.
  - The values of inserts and updates reject a query at runtime, and in types except for a column whose type takes any value, such as `jsonb` ([mutations](mutations.md#values)).
- Types type a query by its value in an expression, `ScalarValue` of `query/select.ts`: the value of an aggregate query, such as `boolean` of `exists` and `boolean | null` of `some`, and of a query whose row a required relation guarantees, such as of `field.form`; the value or `null` of another query, such as of `get`, which is `NULL` without its row whatever its rows mode.
  A query has this value as a member for types only, from which `and`, `or`, `not`, and the operators infer it for each operand.
- Types take a query in an expression as `ScalarQuery`, an interface of the state, the value, and the method `exists` of a query, rather than as a query, which would compare every method of the query.
  So they reject a copy of a query, whose type lacks its methods, but not a copy of a value of type `ScalarQuery`, whose type has `exists`; at runtime, such a copy is a value of a parameter, or an object of column values in a condition, whose keys the compiler rejects as unknown columns.
- `Operand`, the operand of the built-in operators, includes `ScalarQuery`, and `OperandValue` reads the value of a query without inferring it from `ScalarQuery`, which would add instantiations to each call of an operator.
  An object condition reads the operand of the `eq` of `equalityOperators` from the type of its column, rather than inferring it from the method of the column with a check that its result is a predicate, which adds about 165 instantiations, 42%, to a query of an object condition of a column used for the first time ([benchmark](../benchmarks/types/queries.bench.ts)).
  For another `eq`, such as one of `withOperators`, it infers the operand from the method and requires a predicate as its result.
- `in` takes a query of values of a table of any rows, such as of `pluck`, beside a list, as `IN` of the statement of the query, which keeps its order, limit, and offset; the statement of a query of `exists` or of an aggregate has one row.
  - The query keeps its `Db`, as a query in an expression does.
  - At runtime, `in` rejects a query of records, and a value other than an array or a query of a table, such as an expression or a query of `$select`.
    It recognizes a query by the method of the symbol key `valuesQueryNode` of `expression/operators/equality.ts`, as an expression recognizes an operand by `operandNode`; only `SelectQuery` has the method, since `in` rejects every value other than an array and a query of a table, so the other classes need no method that rejects them.
  - Types take the query as `ValuesQuery` of `query/select.ts`, an interface of the state and the method `exists`, as `ScalarQuery` is, and type its values by the result of its state, without `NULL` of a missing row, since `IN` of no rows is `FALSE`.
  - `in` has one signature of a union of a list and a query rather than overloads: an overload of a query after that of a list makes the error of a wrong list name the overload of the query, and before it adds about 8% to the instantiations of a filter of a list ([benchmark](../benchmarks/types/queries.bench.ts)).
- `sql` takes a query of a table of any rows and value, also of records or of rows `many`, as a subquery in SQL text, as [types](types.md#parameters-and-sql-fragments) describe; a query of one value there is the operand that it is in an expression.
- `expr` of a query of one value gives an expression of the value with the operators of its type, such as `form.fields.count().expr().gt(3)`, so that the value stands on the left of an operator; the expression has a type, so `select` takes it.
  - It holds the node of the query in an expression: it keeps the `Db` of the query, is `NULL` without its row whatever the rows mode, and rejects the queries that an expression rejects, at runtime and in types.
    The type of the projection of the query decodes its value and gives the operators: that of the column or the expression of `get`, `pluck`, and the aggregate methods, the type of a count, of the sum of `smallint` and `integer` values, or the Boolean type of `exists`.
  - A query is not an expression: it executes, keeps its `Db` and the relations it uses, and takes `where`, `orderBy`, and `coalesce` after an aggregate.
  - It takes the query from `this`, as the other methods do: a getter, such as `ops`, would type its result by the state of the class and break the covariance of a query, and a callback, such as `expr(value => value.gt(3))`, adds nesting without a gain.
  - The operators are not methods of the query, as in Orchid ORM 1.78.37, such as `q.sum("points").gt(0)`: a custom operator could take the name of a method of a query, so `withOperators` would reject those names, every new method of a query would break the custom types that have an operator of its name, and the query would need a prototype for each type of its value.
  - The operators have no functions of their own, such as `gt(form.fields.count(), 3)`: they belong to types, including custom ones, which would each need a function too.
- The `valueType` part of the state holds what the type of the value gives, its operators and the values that it encodes, which `get`, `pluck`, the aggregate methods, and `exists` set, and which `coalesce` reads too.
  - `SelectQueryState` types the part as `unknown`, and only the states of `expr` and `coalesce` narrow it, so that a query compared with another state, such as a nested query or an operand, does not instantiate the operators of its type.
  - The type of a column or an expression gives the part as an object of two members rather than as parameters of an alias of a state, which TypeScript instantiates with each new mapper; those of a count and of `exists` are interfaces, which it does not instantiate.
  - The mark of `TypedExpression` holds the operators, from which the state of an expression reads them.
  - These choices limit the cost of a query that does not call `expr`: separate parts of the input and the operators add about 11% to an aggregate of a column and 2.5% to an unbound query, a part narrowed by `SelectQueryState` adds about 3% to `find`, and one narrowed by `ScalarQuery` about 8% to a comparison with an aggregate of a relation ([benchmark](../benchmarks/types/queries.bench.ts)).
    With them, an aggregate of a column takes about 3% more, and an aggregate with a fallback about 4% more.

## Finding by a key

- `find` and `findBy` are `where` of the values of a key that makes a query of many rows a query of rows `one`, in one derived query, so they apply to a query of any rows, kind, and value, such as of a relation or after `pluck`: the query of rows `one` rejects with `NotFoundError` without a row, and a query of one row keeps its rows mode, such as `optional`, after the filter ends the guarantee of its row.
  - The values of a key match at most one row, so they add no limit, unlike `take`, and keep the limit and the offset of the query; the query rejects several rows, such as where the database lacks the key or a value depends on the row, such as ``find(sql`id`)``, as a query of a relation `one` does.
    Without a limit, a [mutation](mutations.md) tells a query of `find` and `findBy` from one of `take`, whose rows it cannot limit.
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
  - The callback receives the columns and the relations of the table, as the callbacks of `select` and `where` do ([nested queries and relations](#nested-queries-and-relations)).
  - The callback returns a sort key or an array of them: an expression or a query of one value, sorted in ascending order, or an `Ordering` made by `asc`, `desc`, or `orderBy` of one, which its class tells apart from them.
    An expression without a type sorts too, since sort keys are never decoded.
    A query is the sort key that it is as an operand of an expression ([queries in expressions](#queries-in-expressions)): a scalar subquery of its value, or `EXISTS` of its rows, and `asc`, `desc`, `orderBy`, and the callback reject the queries that an expression rejects.
  - The second parameter of the callback holds expressions over the nodes of the projections selected when `orderBy` is called, so a sort key of a selected field is its projection; a later selection that replaces the field leaves the order on the old expression.
    A field of an aggregate or of `exists` is an expression of its query whose node holds the field, by which lowering finds the projection of the field, so that the statement sorts by it and evaluates the query once: only lowering creates the scalar subquery of an aggregate and `EXISTS` of a query.
    Lowering identifies the selected field rather than its query: each projection of a query is a subquery of its own, which PostgreSQL evaluates apart, so a query selected under several keys has a value under each, such as of `random()`.
    A sort key of the query held apart, such as in a variable, is a subquery of its own too.
    A field of nested rows throws when it is read: nested rows are JSON, which PostgreSQL cannot sort by, and types do not tell them from expressions.
    A query of values gets the expression of its value from another overload.
- `limit` and `offset` apply only to a query of many rows, in types and at runtime, since a query of one row must find a second row to reject it.
  A helper that paginates passes types when it is applied to a query of one row and fails at runtime, since its effect does not record pagination.
  Their counts are non-negative safe integers, sent as parameters; a later call replaces the earlier one.

## Aggregates

- An aggregate method makes a query of the value of an aggregate function over the rows of the query, as a value of rows `one`, whatever its rows and value, unless it is an aggregate query or a query of [`exists`](#exists): it replaces the projections with the projection of the aggregate and ends the guarantee of the row, since an aggregate query always returns one row.
  - `count` without an argument is `count(*)`; with a column or an expression, `count` and `countDistinct` count its values other than `NULL`, each distinct value once for `countDistinct`.
  - `min`, `max`, `sum`, `avg`, `every`, `some`, and `stringAgg` call `min`, `max`, `sum`, `avg`, `bool_and`, `bool_or`, and `string_agg`, whose value is `null` without values other than `NULL`.
  - The argument is a column key or a callback that returns an expression with a type, as of `get` and `pluck`.
    Types do not check that PostgreSQL has the aggregate for the type of the argument, such as `sum` of `text` or `max` of `uuid`, which PostgreSQL rejects when the statement runs.
- A count is a `bigint` of PostgreSQL decoded as a number, with the operators of `orderingOperators`; a count outside the safe integer range of numbers fails to decode with `ResultDecodeError`, and a fragment of `sql(t.bigint)` gives a `bigint`.
- The type of the argument decodes the value of the other aggregates, which PostgreSQL writes as it writes the values of the argument, also where its SQL type differs, such as the `bigint` sum of `integer` values, the `numeric` sum of `bigint` values, or the `text` maximum of `varchar` values; so a type derived with `transform` keeps its values, such as a `Date` of `max`.
  - The average of `smallint` and `integer` values is a `numeric`, which their `Number` decodes with its fractional part; the average of a type whose decoding cannot read a fractional value, such as one that decodes a `numeric` as a `bigint`, fails to decode with `ResultDecodeError`.
  - `avg` rejects a type of the cast type `bigint` when it is called, since PostgreSQL averages its values as a `numeric`, which can have a fractional part that a type of `bigint` values cannot represent; an expression of a type that can represent fractional values, such as `sql(t.doublePrecision)` of the column, averages them.
    Types do not tell it, as they do not tell an aggregate that PostgreSQL lacks for a type.
  - The sum of `smallint` and `integer` values is a `bigint`, which their `Number` decodes, so a sum outside the safe integer range of numbers fails to decode with `ResultDecodeError`, as a count does, before a type derived with `transform` decodes it.
    Its type has the operators of their type.
- It aggregates the rows that the filters, the limit, and the offset of the query choose, so a limit or an offset gives the aggregate of the rows of the page, which the order of the query chooses, and the limit of `take` before it gives the aggregate of at most one row, as does the key of `find` or `findBy` unless a value depends on the row.
  - `count()` ignores the order, since the number of the rows of a page does not depend on it.
  - `stringAgg` joins the values in the order of the query; the other aggregates do not depend on the order of their rows.
- The methods that keep the rows apply to an aggregate query as they apply before it: `where`, `find`, and `findBy` restrict the aggregated rows, and `orderBy` changes the rows of a page and the order of `stringAgg`; `limit` and `offset` reject it as a query of one row, so they come before the aggregate.
  The callback of `orderBy` receives the aggregate as the value of the query, and sorting by it fails in PostgreSQL with a limit, an offset, or `stringAgg`, and has no effect otherwise.
- `get`, `pluck`, the aggregate methods, and `exists` reject an aggregate query, at runtime as well as in types, also after the methods that keep its value, such as `where` and `coalesce`: its rows `one` are the aggregated rows without a limit, so a value of a row would decode several rows as one, and another aggregate would aggregate those rows rather than the row of the aggregate.
  - The `aggregate` part of the state tells an aggregate query or a query of `exists` in types, and a state that may be of one, such as `QueryStateOf<T>`, rejects them too.
    The part adds about 4 instantiations to each method that changes the state, up to 3% of a query ([benchmark](../benchmarks/types/queries.bench.ts)); rejecting them on every query of values would spare it, but would also reject `count` of a query of `pluck`, such as one that a helper or shared code prepares.
  - At runtime, the methods and lowering recognize an aggregate query by the projection of its aggregate, which only the aggregate methods select and `coalesce` keeps, so the node has no part for it.

## Exists

- `exists` makes a query of whether the query has a row, as a `boolean` value of rows `one`, whatever its rows and value, unless it is an aggregate query or a query of `exists`: it replaces the projections with the projection of `exists` and ends the guarantee of the row, since the query always returns one row.
  - It checks the rows that the filters, the limit, and the offset of the query choose, and ignores the selected fields, nested queries among them, and the order, which the number of the rows of a page does not depend on.
  - Executed, it is `SELECT EXISTS (SELECT FROM ... WHERE ... LIMIT ... OFFSET ...)`; selected as a field, `EXISTS (...)` in the select list rather than a packed row; and in a condition, `EXISTS (...)`.
  - The methods that keep the rows apply to it as they apply before it, as to an aggregate query: `where`, `find`, and `findBy` restrict the rows that it checks, and `coalesce` keeps it as it is, since `EXISTS` is never `NULL`.
  - In types, it is marked as an aggregate query, `aggregate: true`, so that `get`, `pluck`, the aggregate methods, and `exists` reject it, as does the callback of a helper.
  - At runtime, the methods and lowering recognize a query of `exists` by the projection of `exists`, which only `exists` selects and `coalesce` keeps, as they recognize an aggregate query.

## Replacing NULL

- `coalesce` replaces a `NULL` value of a query of values, such as of `get`, `pluck`, or an aggregate, with a fallback, keeping the rows mode, so a missing row stays missing.
  It takes a value that the type of the value encodes, without a cast, so that PostgreSQL types the parameter by the value, such as `bigint` for the sum of `integer` values, or an expression; the type of the value decodes the result either way.
  - Types take the values that the `valueType` part of the state tells, as [queries in expressions](#queries-in-expressions) describe: those that the type of the value encodes, so that the sum of a `numeric` column takes a number; a query of records has `never`.
    Overloads of a value and of an expression would not make a call of `coalesce` cheaper ([benchmark](../benchmarks/types/queries.bench.ts)).
  - Types take an expression of the values of the value, since its type decodes them, and keep `null` when the expression can be `NULL`.
    They check the values of the expression rather than its SQL type, as for the operands of operators, so PostgreSQL rejects an expression of a type that it cannot coalesce with the value, such as `text` with `numeric`.
  - Types remove only `null` from the value, which stands for `NULL` among the values of a type, as [types](types.md) state: `undefined` returned by a decoder stays, and so do the `unknown` values of `json` and `jsonb`.
    A JSON `null` value of a shape of `of` that includes `null` stays `null` too, while types remove it.
- An aggregate keeps its fallbacks apart from its call, which lowering builds, and lowering wraps the call in one `coalesce` with them in order; the projection of `get` and `pluck` wraps its expression.

## Nested queries and relations

- The references of the callbacks of `select`, `where`, and `orderBy` have the columns of the query source and the relations of its table in the schema context of the query, all as own enumerable properties, so returning or spreading them in `select` selects every field their type has; the callbacks of `get`, `pluck`, and the aggregate methods get only the columns.
  The relations add about 35 instantiations to a call of `where` with a callback on a query of a table with relations, 19% of a query of `where` of a callback and `pluck`, and about 30 to a call of `orderBy` with a callback, 22% of a query of `orderBy` of a callback and `pluck` ([benchmark](../benchmarks/types/queries.bench.ts)).
  A relation gives an unbound query of its related records over a new occurrence of the target table, in the context of the target table in the same schema, even for a query of a `Db`.
  Its relation filter compares the columns of the keys with SQL `=` in order, built from SQL nodes rather than by calling the `eq` operators of their types.
  In types, a schema context whose table key is `string`, such as that of the queries a `Db` accepts, has no relations, since queries of relations there would keep the queries of a `Db` from being assigned to them.
- A selected field is an expression with a type, a query of either kind, whose rows become the value of the field, or a literal.
  A nested query bound to a `Db` runs only in a statement of the same `Db`, since the statement takes the options of its `Db`, such as the PostgreSQL schema; lowering checks the `Db` by identity at any depth, and types do not check it.
  So `toSQL` of an unbound query rejects a nested query bound to a `Db`, which `$compile` of that `Db` compiles.
  Nested rows are the result that their query would give when executed; the state of the nested query adds the relations it selects to the state of the parent.
- A further query that nests 12 relations up to 6 levels deep, with sibling relations at several levels, takes about 12 times the type-check instantiations of its root query without them, and the first such query of a consumer about 1.9 times those of a further one ([first query](../benchmarks/types/first-use.bench.ts), [further queries](../benchmarks/types/queries.bench.ts)).

## Queries of `$select`

- `$select` of a `Db` and of a schema starts a bound or an unbound query of one record whose fields are the values of expressions, the results of independent queries, and literals, with the first two selected in one statement without a source.
  It takes an object of the fields that the callback of `select` returns, under the same rules, and reads its keys and values when it is called.
  - The field of a query has the result that the query gives when it is executed: its rows are nested, so a query of one row without its row rejects with `NotFoundError` whose path is the field.
  - Its state has the record, rows `one`, and the relations that its queries select, as `SelectionState` gives them.
  - The methods `$select` are independent of the tables and relations of their schema, so that they are the same in every schema and `Db`; a query of `$select` of a `Db` is checked when it runs, as an awaited query is.
- The query is a `RecordQuery`, a class apart from `SelectQuery`, with the members that differ by kind and `toSQL`, since the methods of a query of a table have no source to apply to.
  It is covariant in its state and its kind, like `SelectQuery`.
  A selection rejects it as a field, in types and at runtime.
- `$execute` and `$compile` of a `Db` take a query of `$select`, a [mutation](mutations.md), and a [query of SQL text](sql-queries.md) beside a query of a table, and check them in the same way: in types the relations that they select, and at runtime their `Db`, the relations, the bound queries, and the tables at any depth.
  Their parameter is constrained by a union of the four classes rather than overloaded, since a call that matches no overload reports the errors of the last overload, which would name another class.
  The query of `$select` in the union adds about 6% to the instantiations of the first unbound query that a consumer executes and up to 1.5% to each further one, the mutation about 0.3% to each, and the query of SQL text none ([first query](../benchmarks/types/first-use.bench.ts), [further queries](../benchmarks/types/queries.bench.ts)).

## Queries of a Db

- A `Db` rejects a query bound to another `Db`.
- A `Db` compiles a statement with the tables of its schema, and the compiler rejects an occurrence of any other table at any depth of the statement, such as in a scalar subquery, `EXISTS`, a join, or a derived source, when it compiles the occurrence.
- A `Db` compiles a query with the relation definitions of its schema, and lowering rejects a query of any other definition at any depth, by identity rather than by name, so a relation that another schema declares with the same name and keys is rejected, while a tenant schema adds relations of its own and keeps the shared ones.
  In types, `$compile` and `$execute` reject a query whose state selects a relation that the relations of the `Db` lack by table key, name, kind, target, and `required`; types cannot tell two definitions of the same shape apart.
  A condition or another expression, such as of `expr`, does not carry the relations of its queries, so they stay out of the state, and only lowering rejects a relation of one that the `Db` lacks, at runtime.
  The relations of a query only accumulate in its state: `clearSelect`, `get`, `pluck`, the aggregate methods, and replacing a field keep them in types after the runtime drops their nested queries, which never under-approximates the relations that its selections need.
  An awaited query of a `Db` is checked only at runtime: the references of its `select` give the relations of the `Db`, but a nested query of another schema can select others.

## Helpers

- `use` returns the query of its callback, which must have the source occurrence of the query the callback receives at runtime and its kind in types, so the query `use` is called on sets the binding.
  The check does not tell a derived query from an ancestor, which drops the clauses added after it.
  Branches of a callback that leave different states give a union of queries, which takes the methods that keep the state, such as `orderBy`, and `where` unless one of the queries is guaranteed, but not those that change it, such as `select` and `take`, unless TypeScript reduces the union to a query of fewer fields.
- The callback of a helper of `defineHelper` receives a query of either kind whose result is a marker record, and the effect of the helper is read from the query it returns: the fields selected beside the marker, the rows mode, `one` after `take` or `required`, and `nullable` or `optional` after the method of the same name, and whether the callback ends the guarantee of the row, which its query starts with.
  - The effect records only the rows mode that the callback ends with: `required` is typed as `take`, so a query of one row keeps its rows mode in types while the helper makes it `one`, and a helper that calls `nullable` before `optional` or `required` passes types on a query of values and fails at runtime.
  - The effect records only whether the callback ends the guarantee, not which call ends it: a helper that calls `required` makes the row of a required relation `nullable` in types, as a filter does, while the helper makes it `one`.
  - The marker starts with no selected keys and accumulates their union on every selection, including through another helper.
    The marker prevents a branch selecting extra keys from being reduced to one selecting fewer fields or none, preserving possible overwrites of input fields.
  - The public type of a helper holds the selected fields without the marker, so that the declarations of a module exporting a helper never name it.
  - Every branch of a helper must retain the marker and remain a record query; `clearSelect`, `get`, `pluck`, the aggregate methods, and `exists` are rejected because its effect cannot describe the discarded input fields.
  - A helper adds or replaces fields by the same merge as `select`, for every branch of its effect; a query of values rejects a helper that selects fields or ends with a call of `nullable` in any branch.
  - A helper checks that its callback returns the input query or one derived from it, also when called directly.
    The returned query keeps the kind and the `Db` of the input query.
- The callback of a helper defined with a query of a schema or a `Db` receives a query of its schema context in types, and at runtime the query it is applied to, whose schema shares the definitions of the relations by identity when it includes that schema.
  The callback reads relations by name from the query it is applied to, so applying a helper that selects relations of its schema context requires a query of its table under the same key with those relations, also when it is called directly.
  Relations of other schemas that the helper selects, such as of an independent query that it nests in a field, stay in the state of the result for the `Db` to check; a helper defined with a table reads no relations.
  The effect does not record the relations that a condition of the callback reads, which stay out of the state, so types accept a helper that filters by a relation of its schema context on a query without the relation, where the callback fails to read it.
- The callback of a filter of `defineFilter` defined with a query of a schema or a `Db` receives the relations of its schema context in types, and at runtime those of the query of `where`, so a query whose schema context lacks them rejects the filter in types.
- `defineExpression` returns its callback, as `defineFilter` does, so it only gives the callback its types: a query of a schema or a `Db` gives the relations of its schema context, and a table only the columns.
  At runtime, the callback receives the references that its caller passes, so it refers to the columns of their occurrence of the table, in whichever query it is called.
  - A call has the type that the callback returns, which must be an expression or a query of one value, so it keeps the nullability and the operators of its values, and `select` takes it as it takes that value: an expression without a type, such as of `sql<T>`, cannot be selected ([selection](#selection)).
    `defineFilter` types its result as a condition, which `select` rejects.
  - The result is a type parameter, which gives `and`, `or`, and `not` in the callback no table, so they reject objects of column values there; a `where` in the callback takes them.
  - The further arguments are a tuple of the parameters of the callback, as of `defineHelper`, so a parameter without a type is `unknown`, and using it fails in the callback.
  - An expression defined with a query of a schema or a `Db` requires the relations of its schema context, so the callbacks that receive only the columns, of `get`, `pluck`, the aggregate methods, and the values of `update`, call only one defined with a table.
- A helper checks the query it is applied to by the constraint of its state rather than by a conditional type: TypeScript defers a conditional type of a generic state and accepts a query for it only when the query fits both branches, one of which is the error.
  So a function generic over the state applies every helper that the constraint of its state allows: one that selects fields or ends with `nullable` when the constraint has `value: false`, and one that reads relations when the constraint has a schema context with them.
  The constraint of `value` is `false` or the error that names what the helper cannot do, so that the error of a query of values names it; for a missing relation, TypeScript names the relation itself.
