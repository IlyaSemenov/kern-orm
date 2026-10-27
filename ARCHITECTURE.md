# Architecture

kern-orm is a fully typed relational query builder for PostgreSQL rather than a traditional ORM.
It has no managed entities, identity map, dirty tracking, or unit of work.

Its core promises:

- Queries infer results, parameters, nullability, and nested selections.
- Nested relations load in a constant number of round trips through subqueries that aggregate their rows as JSON.
- Queries join the ambient transaction of the current async context without passing a transaction around.

The public API is not settled before 1.0 and may change in any release.

## Motivation

kern-orm exists to solve problems of production projects on Orchid ORM:

- Test isolation ([orchid-orm#798](https://github.com/romeerez/orchid-orm/issues/798)): code that outlives a timed-out test or hook keeps querying, and its queries must not run in the transaction of another test or on the pool.
  A test transaction level belongs to the callback of one test run, and a failure to start one rejects instead of hanging.
- Transaction routing ([orchid-orm#803](https://github.com/romeerez/orchid-orm/issues/803), [#808](https://github.com/romeerez/orchid-orm/issues/808)): every statement of a transaction, including its own settings, runs on its connection, whatever options wrap the call.
- After-commit hooks ([orchid-orm#817](https://github.com/romeerez/orchid-orm/issues/817), [#825](https://github.com/romeerez/orchid-orm/issues/825)): hooks run for the work that was committed, never for work rolled back to a savepoint, whichever instance of the database registered them.
- Reusable column types ([orchid-orm#405](https://github.com/romeerez/orchid-orm/issues/405)): a type is a standalone value that unrelated projects share, extend, and compose without a base table or a validation library.
- Shared tables across schemas ([orchid-orm#696](https://github.com/romeerez/orchid-orm/issues/696)): tenant and SaaS schemas share table definitions with their own relations, and typed business logic shared between them uses only what both have.
- Dynamic PostgreSQL schemas ([orchid-orm#762](https://github.com/romeerez/orchid-orm/issues/762)): a PostgreSQL schema resolved at runtime, such as the schema of the current tenant from the async context, is read only when a query is compiled, never when a database is created or a schema is bound.
- Singleton tables ([orchid-orm#752](https://github.com/romeerez/orchid-orm/issues/752)): a table that holds at most one row, such as application settings, is read and upserted without a sentinel key passed to every query or an `all()` that needs a comment at every use.
- Migration verification ([rake-db-testing](https://github.com/IlyaSemenov/rake-db-testing)): every migration applies, rolls back, and applies again, and data scenarios check how it transforms existing rows; kern-orm will include it.

## Implemented

Module paths are relative to `packages/kern-orm/src/`.

### Public concepts

- **Type** (`type/`): a PostgreSQL type, the conversion between JavaScript values and their PostgreSQL text representation, and the operators of its expressions, shared by columns, parameters, and SQL expressions.
  PostgreSQL type parameters, such as `varchar.with(255)`, change only the SQL type name and not the cast type of parameters, so they apply at any point of a chain of type changes.
- **Column** (`table/column.ts`): a type with column attributes: its physical name and the key that it forms alone, the primary key or a unique key.
  A column is not a type: SQL fragments and parameters accept only types, and type changes such as `nullable` and `transform` precede column attributes.
  Its type tells the kind of that key: `"primaryKey"` after `primaryKey`, `"unique"` after `unique`, `undefined` for a type without attributes or after `columnName` of a type, and a union where the type does not tell, such as `Column<T>`.
  A column forms one key at most: `primaryKey` and `unique` reject a column that forms a key, in types and at runtime, and in types also a column whose type does not tell its key.
- **Table** (`table/`): immutable descriptor of a physical table name, its columns, and its keys, with no relations, PostgreSQL schema, or database connection.
  `defineTable` accepts types and columns and turns each type into a column without attributes.
  A column is found only under an own key of the columns: a lookup ignores properties inherited from the object prototype, such as `toString`.
  - A key of one column is marked on its column, and a key of several columns is listed in the options of `defineTable`, so that each key has one place.
    `defineTable` rejects several columns marked with `primaryKey`, a primary key both on a column and in the options, a key of the options with fewer than two columns or with an unknown or repeated column, a nullable column of the primary key, and two keys of the same columns in any order.
  - `keys` of a table holds the primary key, or `undefined`, and the unique keys, those of the columns in their order followed by those of the options, as frozen lists of column keys; a primary key of the options keeps its order.
  - Keys state what the database guarantees, by a constraint, a unique index, or the query of a view; kern-orm creates no constraints from them.
  - The type of a table tells its keys by `TableKeys`, from the types of its columns and its options, and gives `AnyTableKeys`, which tells none, where the types do not tell them: for a column whose type does not tell its key, for several columns marked with `primaryKey`, for options whose keys are not tuples of single column keys, such as with a union in a key or in the list of unique keys, and for a table typed as `Table<Name, Columns>`.
    A union of options gives the union of their keys; the options of `defineTable` are a required parameter of its second overload, so that options that may be `undefined` give the keys of the columns as one of them.
  - `TableKeys` holds the keys only in a member that takes and returns them, so that it is invariant in them, and that is required and named by an unexported symbol, so that no assignment gives a table more or fewer keys, and a type that drops the member, such as `Pick` of `primaryKey` and `unique`, tells no keys.
    Its members `primaryKey` and `unique` have the types of `AnyTableKeys`, so that intersecting it with `AnyTableKeys`, as the `this` types of query methods do, compares no tuples.
  - `defineTable` computes the keys of a table before writing them as the arguments of `TableKeys`, since a deferred type reference, or a type parameter that `infer` leaves for `never`, makes the type of a table generic, which TypeScript instantiates with the query states over it again on each call, such as of `$execute` ([benchmark](benchmarks/types/queries.bench.ts)).
- **Schema** (`schema/`): immutable collection of tables and their relations with query entry points.
  `defineSchema` composes it of tables by their keys and of other schemas, whose table objects and relation definitions it includes as they are, so the same table belongs to several schemas and a query of an included schema runs on a `Db` of the composed one.
  A key has one table and a table has one key in a schema: composition rejects a key of two different tables and a table under two keys, and includes a table that several parts include under the same key once.
  Relations are declared per schema, not per table, so schemas sharing a table have different relations; the relations of a table in a schema are those declared under its key.
- **Relation** (`schema/relation.ts`): relation of a table of a schema to the records of a target table, `many` or `one`, by columns of the two tables compared with SQL `=` in order.
  `many` and `one` declare it, and `$relations` of a schema defines it under the key of its table and its name, returning a new schema.
  A definition is an object that composition carries by identity: a relation that several parts include is one definition, and another definition of a relation of a table is rejected, whether it comes from another part or from `$relations` of a schema that has the relation, even with the same columns.
  `$relations` rejects a target outside the schema and checks the keys: own columns of their tables, the same number of them, at least one, and pairs of columns that `isEqualityCompatible` accepts.
  It also rejects a relation name that is a column key of its table or starts with `$`, in types and at runtime, since the references of `select` have both the columns and the relations of the table.
  The schema keys of the source and the target table of a definition are the same in every schema that has it, since composition includes every table of a part under its key.
  - The columns `to` of a relation `one` include a key of the target, primary or unique, so that they match at most one record; columns beyond a key are allowed.
    `one` rejects other columns `to` in types where the type of the target tells its keys, and `$relations` at runtime.
  - A relation `one` is required or not: without its record, a query of a required relation rejects, and of a relation that is not required gives `null`; a relation `many` is not required.
  - Unless `one` sets `required`, a relation is required when no column `from` is nullable, the columns `from` include no key of the source, and the columns `to`, in any order, are a key of the target, primary or unique.
    Columns `from` that include a key of the source match each record of the target from at most one record, as on the side of a one-to-one relation without the foreign key, whose record may be missing; the side with the foreign key, such as the user of a profile whose `userId` is unique, sets `required`.
    At runtime, a column is nullable by `isNullable` of its type and the keys are `keys` of the tables; in types, a column is nullable by `null` in the output of its type and the keys are those that the type of the table tells.
  - Where types cannot tell, the inferred `required` is `boolean`, which gives the result of a query `null` as when the relation is not required: for a key `to` typed as a union or with a union in a position of its tuple, for `required` of type `boolean`, and for a source or a target whose type does not tell its keys.
    `required` typed as an optional property, which may be missing at runtime, gives the union of its value and the inferred one.
    A key `from` typed as a union is nullable when any of its columns is, and includes a key of the source when all of its columns together do; `one` rejects a key `to` typed as a union only when all of its columns together include no key of the target.
    A target typed as a union of tables, or with a union of keys, gives the union of the results of each of them, and `one` rejects its columns `to` only when no table of the union has a key among them.
  - The inferred types are never narrower than the result at runtime.
    A type whose `transform` decodes values to `null` while its SQL type is not nullable makes a column nullable only in types: its relation is required only at runtime and rejects without its record where types give `null`.
- **Database** (`execution/`): a driver and the ambient transaction coordinator of one connection domain.
  `bind` binds schemas to it, and all schemas bound to the same database share its transactions.
- **Db** (`execution/db.ts`): a schema bound to a database and a PostgreSQL schema; it compiles and executes queries over the tables of its schema.
  `DbOf` types the `Db` of a schema, and a `Db` of every schema that includes it fits that type, since the types of entries and relations accept more tables and relations, so code shared by several schemas takes such a `Db` as a parameter.
  TypeScript compares the entries of two `Db` types member by member, as it compares any queries of different states; the methods of a `Db` and a schema are generic or typed by `this`, so that comparing them compares no queries.
- **Test helpers** (`execution/testing.ts`, exported from `kern-orm/testing`): test transactions and test fixtures of a database created with `test: true`, created once per project with the `before` and `after` hooks of a test runner.
  They run through the transaction coordinator of the database.

Members of schemas and `Db` other than tables start with `$`, and table keys must not.
Column keys must not start with `$` either, which keeps such names free for members of the column references passed to query callbacks.

Queries come in two kinds that share the query methods and differ only by execution context:

- An unbound query starts from a schema, needs no database connection, and can be defined at module level.
  A `Db` can execute it with `$execute` if its schema contains the tables and the selected relations of the query and every bound nested query belongs to that `Db`.
- A bound query starts from a `Db` and executes there when awaited or nested in a query that the same `Db` runs; its methods return queries bound to the same `Db`.

### Internals

- **Query** (`query/`): immutable query object wrapping a semantic query node (`query/node.ts`), whose fields are expressions or the rows of nested queries.
  Its type carries one state object of its table, the schema context of its relations, the record or value of its rows, its result mode, and the relations whose records it and its nested queries select; a method replaces only its own parts, so new state is a new part rather than a new type parameter.
  The schema context is the relations of the schema the query starts from, by table key, and the key of its table there, so the same table queried from schemas of different relations gives different types.
  A query of `from(table)`, and of a table without relations in its schema, has the context without relations, and a query whose table has relations is also a query of the same table without them in types.
  TypeScript measures a query as invariant in its state, unreliably, so that a query of another state fails the comparison of type arguments and is compared member by member, through the generic signatures of every method, once for each pair of types, such as for each new query passed to `$execute`.
  A parameter that takes queries of other states, such as of `$execute`, `$compile`, and `defineHelper`, and a nested query of a selection are typed by `QueryOfState`, which TypeScript compares by the state and a protected mark that it inherits from the base class of `SelectQuery`: no other class has the mark, and a copy of a query made by spread or rest lacks it.
  With it, a further query executed by `$execute` takes a quarter to a third of the instantiations that it takes with a parameter of type `SelectQuery` ([benchmark](benchmarks/types/queries.bench.ts)), and the first filter or helper of a table a tenth ([benchmark](benchmarks/types/definitions.bench.ts)).
  At runtime, a query holds the context of its table in the schema or `Db` it starts from, which each of them creates once for each of its tables, whose relations the references of `select` start; a query of `from(table)` holds the context without relations.
- **AST** (`ast/`): the SQL AST, structural expression and statement nodes, and their pure transformations, such as Boolean simplification.
  A select statement nests queries in scalar subqueries, `EXISTS`, and derived sources of `FROM`, plain or `LATERAL`; nodes store no lexical scopes, which the compiler derives from the position of a query in the tree.
- **Expression** (`expression/`): public wrapper over an expression node and its type, with operators, `and`/`or`/`not`, and `sql`/`param` fragments.
  Every expression has `isNull`; the operators of its type are added to it and replace `isNull` if one has its name, in types and at runtime alike.
  SQL `=` is a capability of a type given only by the operators of `equalityOperators`, which `orderingOperators` include; these operators are marked, so that another operator named `eq` does not give it, and an array type has them only when its element type has the capability.
  Two types are compared with `=` as they are, as the keys of a relation, when both have the capability and they are one SQL type by their cast types, whatever their type parameters and the representation of their values, or both belong to an explicit family of one B-tree operator family: `smallint`, `integer`, and `bigint`, or `text` and `varchar`.
  Equal TypeScript types are not enough, such as of `uuid` and `text`, which PostgreSQL does not compare.
  An object condition matches a column by calling the `eq` operator of its type, whichever operator it is, and accepts the values of its single operand; it matches `null` with `IS NULL` without calling operators.
  It is typed by the values it returns and the values it accepts in comparisons, which differ for types such as `timestamptz`, which also accepts a `Date`.
  An operator defined as a function receives expressions of the type that `withOperators` was called on, even on a type derived from it, so its arguments keep that encoding and its `self` has the operators its definition was typed with.
  A generic operator from `defineGenericOperator`, such as `lt` of `orderingOperators`, receives the expression with its own type; its method is typed by an `OperatorSignature` interface that reads the value types of the expression from `this`, because TypeScript cannot instantiate a generic function type.
  Its `Self` constraint checks which types can receive it through `withOperators`, independently of its method signature on derived types; the implementation accepts any expression because `transform` can change the value representation.
  An expression without a type, such as `sql<T>`, has `isNull` and the operators of `equalityOperators`, because a TypeScript type does not determine a SQL type.
- **Lowering** (`lowering/`): turns the semantic node of a query into a SQL select statement of the AST, which the compiler compiles; the compiler knows no relation definitions or semantic query nodes.
  The rows of each nested query become a scalar subquery of their packed rows in place of its field, and a query without nested queries keeps its projections.
  The statement of an executed query sorts by the positions of its projections, while the statement of a nested query keeps its sort expressions, which packing reads.
  For a `Db`, lowering rejects a query of a relation outside its definitions and a nested query bound to another `Db` at any depth.
- **Compiler** (`compiler/postgres/`): turns an AST into SQL text, parameters, and result decoding metadata.
  Parameters and source aliases belong to the whole statement, apart from the lexical scopes that decide which sources a column reference sees.
  Whether an operand needs parentheses depends only on its node kind and its position in the parent, decided in one place.
- **Result** (`result/`): decodes driver rows and packed nested rows by the result plan of a compiled query, and decides which keys a record can have.
  The result plan is internal: `toSQL` and `$compile` return only the text and parameters of a statement.
- **Nested rows** (`lowering/nested.ts`): builds a query that packs the rows of a nested query as JSON, with the result plan that decodes them.
- **Transaction coordinator** (`execution/transaction.ts`): the only place that decides which connection executes a statement.
- **Driver** (separate packages): transport, pooling, and connections.
  It sends parameters as text without declared types and returns result values as text, so that types alone define how values are represented and the statement text alone determines the types of parameters.
  A connection runs its statements one at a time in the order of calls, so a statement sent before `COMMIT` or `ROLLBACK` completes before it.
  The coordinator releases a transaction connection whatever the outcome, passing the failure of `BEGIN`, `COMMIT`, or `ROLLBACK`; the driver returns such a connection to its pool only once it is idle, and never returns a lost one.
  Closing a driver waits for the transactions on its reserved connections to end, including those still waiting for a connection, and then closes the connections.

### Invariants

- Column references point to an occurrence of a source (`SourceNode`), a table or a derived source, by object identity, never by alias string.
  A reference to a derived source names the key of a projection of its query, never a column of a physical table.
  The compiler gives every occurrence an alias unique in the statement.
- Every identifier the compiler generates, such as an alias or the SQL name of a projection, fits the 63 bytes of a PostgreSQL identifier in any server encoding, since PostgreSQL truncates a longer one ([PostgreSQL](https://www.postgresql.org/docs/current/sql-syntax-lexical.html#SQL-SYNTAX-IDENTIFIERS)); a character other than ASCII counts as 4 bytes, the most it takes in a server encoding.
  - An alias is the name of its table, or `subquery`, cut to 50 bytes and numbered when the statement already has it.
  - Rows are decoded by position, so the key of a result field stays apart from the SQL name of its projection, which only a reference through a derived source uses.
    A key of up to 50 bytes is the name itself, and a longer key is named by its prefix of more than 50 bytes and its position, so the names of the projections of a query differ.
- A column reference resolves to a source visible from its position, as in PostgreSQL ([PostgreSQL](https://www.postgresql.org/docs/current/queries-table-expressions.html#QUERIES-LATERAL)); the compiler rejects any other reference, including one to a source that has an alias elsewhere in the statement, such as in a sibling subquery:
  - the select list, `WHERE`, `ORDER BY`, and the subqueries in them see the sources of their query and of enclosing queries;
  - the `ON` condition of a join sees the sources up to the joined one;
  - a plain derived source sees only the sources of enclosing queries, and a `LATERAL` one also the sources before it in the same `FROM`;
  - `LIMIT` and `OFFSET` see only the sources of enclosing queries.
- Every place of a source in a statement is its own occurrence: a query inserted twice declares its sources twice under different aliases.
  A source that appears where it is already visible, such as a query nested in itself or a source joined twice, is rejected, since its column references would be ambiguous; a nested query over the same table starts from its own `from`.
- A scalar subquery selects exactly one field.
- Boolean logic is an expression tree; the compiler parenthesizes by tree structure, not by call order.
- `and`/`or`/`not` simplify constants only with identities valid in three-valued logic.
  An empty `IN` list is `FALSE`, an empty `and` is `TRUE`, and an empty `or` is `FALSE`.
- Built-in Boolean expressions carry the Boolean runtime type for encoding and decoding.
  Their nullability is tracked only in TypeScript: results include `null` when the expression an operator is called on or an operand expression is nullable; `isNull` and `in` with an empty list never do, and `and`/`or` include `null` when any operand does.
  The shared runtime type does not describe whether an expression can evaluate to `NULL`; result decoding preserves `NULL` independently of it.
- Library code builds expressions from nodes and calls no expression method except `eq` for an object condition, so a custom operator changes only its own calls and the object conditions of its type.
- Types, columns, and expressions are told apart at runtime by a brand or a class, never by their shape or `typeof`, so `sql`, `param`, and `defineTable` reject a column where a type is expected.
- The internals of an expression live under symbol keys, so operators of any name cannot replace them; the operators of a type are methods of an expression prototype created once per type.
  `withOperators` rejects an operator named `then`, which would make expressions thenable.
- Objects of column values in `and`/`or`/`not` stay unresolved `values` nodes until `where` resolves them against its source; the compiler rejects an unresolved one.
- Query filters are kept as separate `relation`, `scope`, and `user` predicates combined with `AND` at compilation; `where` adds only to `user`, so a user `OR` never bypasses the relation filter ([orchid-orm#845](https://github.com/romeerez/orchid-orm/issues/845)).
- PostgreSQL infers the type of every parameter from the statement text.
  `param` with a type casts its parameter to the cast type of the type, which omits type parameters such as the scale of `numeric(10,2)`, so that the operators of the type apply even where nothing else types the parameter, and type parameters do not constrain its value.
  `param` with an expression adds no cast, since operator definitions use it beside that expression, which types it.
  It returns a value that is already an expression, such as an operand of a generic operator, as it is, keeping its type, if it has one, and the nullability of its TypeScript type.
  A compared value stays without a cast, since the expression it is compared with types it, and so does a value interpolated into `sql`.
- A parameter without a type is encoded by its JavaScript type.
- A string pattern of `like` and `ilike` is PostgreSQL text and is never encoded with the type of the expression, which `transform` can give another representation; a pattern expression keeps its own encoding.
- Raw SQL fragments keep interpolations as nodes; parameters are numbered only when the complete statement is compiled, in the order of the text across nested queries.
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
- The result mode of a query has two independent parts: its rows, which are `many` for an array, `one` for a row that must exist, `nullable` for a row that is `null` when missing, or `optional` for a row that is `undefined` when missing, and whether a row is the value of its only projection instead of a record.
  The same rows mode gives the same result to an executed query and to nested rows.
  `take`, `get`, and `pluck` keep `optional`, so `take().optional().get("a")` and `take().get("a").optional()` are the same query.
  - A query of a relation `many` starts with rows `many`, and of a relation `one` with rows `one` when the relation is required and `nullable` otherwise.
  - `take` turns `many` into `one` and adds `LIMIT 1`, keeping the offset and a limit of zero, so that `limit(0).take()` finds no row; a query of one row stays as it is.
  - `optional`, `nullable`, and `required` turn a query of one row into `optional`, `nullable`, and `one`, and reject a query of many rows.
  - The value of a missing row is never `null`, which would read as a `NULL` value: the method `nullable` rejects a query of values, and `get` and `pluck` turn rows `nullable` into `one`.
  - `pluck` replaces the projections with one and makes the rows values, keeping the rows of the query apart from rows `nullable`; `get` is `pluck` followed by `take`.
  - `select` and `clearSelect` reject a query of values, at runtime as well as in types; `get` and `pluck` replace its projection.
  - The rows do not imply a limit: only the change from `many` to `one` adds `LIMIT 1`, since a relation `one` must detect several matches.
  - The result mode applies to an executed query and to packed nested rows; a query nested in a scalar subquery, `EXISTS`, or a derived source keeps only its SQL.
  - The result type of a query state is the union of the results of every mode it allows, such as of a union of rows modes or of states; `$execute` infers the whole query, so a union of queries gives the union of their results.
- The key of a field names only the field of a record: `where`, `orderBy`, and column references resolve against the columns of their source, never against selected keys.
- `orderBy` adds sort keys after those of earlier calls, and applies to a query of any rows: sorting a query of one row is the same as sorting it before `take`.
  - A string names a column, sorted in ascending order, and an object gives columns with their directions in the order of its keys, which JavaScript gives to integer-like keys first.
  - A direction is `asc` or `desc`, optionally followed by `nulls first` or `nulls last`, in lower case.
    The columns and directions of an object are checked at runtime too, since TypeScript accepts a computed key of type `string` as any column.
  - The callback returns a sort key or an array of them: an expression, sorted in ascending order, or an `Ordering` made by `asc`, `desc`, or `orderBy`, which its class tells apart from an expression.
    An expression without a type sorts too, since sort keys are never decoded.
  - The second parameter of the callback holds expressions over the nodes of the projections selected when `orderBy` is called, so a sort key of a selected field is its projection; a later selection that replaces the field leaves the order on the old expression.
    A field of nested rows throws when it is read: nested rows are JSON, which PostgreSQL cannot sort by, and types do not tell them from expressions.
    A query of values gets the expression of its value from another overload rather than from a conditional type of the state, which would keep a query from being assigned to a query of a wider state.
- `limit` and `offset` apply only to a query of many rows, in types and at runtime, since a query of one row must find a second row to reject it.
  A helper that paginates passes types when it is applied to a query of one row and fails at runtime, since its effect does not record pagination.
  Their counts are non-negative safe integers, sent as parameters; a later call replaces the earlier one.
- An executed query sorts by the position of the projection that has the value of a sort expression, such as `ORDER BY 2`, and by other expressions as they are; a nested query sorts by its sort keys as packing describes, with the same rule of which projection has the value.
  Only a projection of the same column or of the same expression node is guaranteed to have the value of a sort expression.
  A selected expression repeated in `ORDER BY` would get parameters of its own: the statement would send their values twice, and PostgreSQL would evaluate it again unless it finds the two expressions equal, which it does once a custom plan folds the parameters into constants but not in a generic plan, such as of a prepared statement.
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
  A union of a bound and an unbound query, such as of a conditional expression, is two types, whose overloaded methods TypeScript cannot call until the union is typed as a query of either kind.
- `use` returns the query of its callback, which must have the source occurrence of the query the callback receives at runtime and its kind in types, so the query `use` is called on sets the binding.
  The check does not tell a derived query from an ancestor, which drops the clauses added after it.
  Branches of a callback that leave different states give a union of queries, whose overloaded methods, such as `select`, TypeScript cannot call, unless TypeScript reduces the union to a query of fewer fields.
- The callback of a helper of `defineHelper` receives a query of either kind whose result is a marker record, and the effect of the helper is read from the query it returns: the fields selected beside the marker, and the rows mode, `one` after `take` or `required`, and `nullable` or `optional` after the method of the same name.
  - The effect records only the rows mode that the callback ends with: `required` is typed as `take`, so a query of one row keeps its rows mode in types while the helper makes it `one`, and a helper that calls `nullable` before `optional` or `required` passes types on a query of values and fails at runtime.
  - The marker starts with no selected keys and accumulates their union on every selection, including through another helper.
    The marker prevents a branch selecting extra keys from being reduced to one selecting fewer fields or none, preserving possible overwrites of input fields.
  - The public type of a helper holds the selected fields without the marker, so that the declarations of a module exporting a helper never name it.
  - Every branch of a helper must retain the marker and remain a record query; `clearSelect`, `get`, and `pluck` are rejected because its effect cannot describe the discarded input fields.
  - A helper adds or replaces fields by the same merge as `select`, for every branch of its effect; a query of values rejects a helper that selects fields or ends with a call of `nullable` in any branch.
  - A helper checks that its callback returns the input query or one derived from it, also when called directly.
    The returned query keeps the kind and the `Db` of the input query.
- A `Db` rejects a query bound to another `Db`.
- A `Db` compiles a statement with the tables of its schema, and the compiler rejects an occurrence of any other table at any depth of the statement, such as in a scalar subquery, `EXISTS`, a join, or a derived source, when it compiles the occurrence.
- A `Db` compiles a query with the relation definitions of its schema, and lowering rejects a query of any other definition at any depth, by identity rather than by name, so a relation that another schema declares with the same name and keys is rejected, while a tenant schema adds relations of its own and keeps the shared ones.
  In types, `$compile` and `$execute` reject a query whose state selects a relation that the relations of the `Db` lack by table key, name, kind, target, and `required`; types cannot tell two definitions of the same shape apart.
  The relations of a query only accumulate in its state: `clearSelect`, `get`, `pluck`, and replacing a field keep them in types after the runtime drops their nested queries, which never under-approximates the relations a query needs.
  An awaited query of a `Db` is checked only at runtime: the references of its `select` give the relations of the `Db`, but a nested query of another schema can select others.
- The references of the callback of `select` have the columns of the query source and the relations of its table in the schema context of the query, all as own enumerable properties, so returning or spreading them selects every field their type has; the callbacks of `where`, `get`, and `pluck` get only the columns.
  A relation gives an unbound query of its related records over a new occurrence of the target table, in the context of the target table in the same schema, even for a query of a `Db`.
  Its relation filter compares the columns of the keys with SQL `=` in order, built from SQL nodes rather than by calling the `eq` operators of their types.
  In types, a schema context whose table key is `string`, such as that of the queries a `Db` accepts, has no relations, since queries of relations there would keep the queries of a `Db` from being assigned to them.
- A selected field is an expression with a type or a query of either kind, whose rows become the value of the field.
  A nested query bound to a `Db` runs only in a statement of the same `Db`, since the statement takes the options of its `Db`, such as the PostgreSQL schema; lowering checks the `Db` by identity at any depth, and types do not check it.
  Nested rows are the result that their query would give when executed; the state of the nested query adds the relations it selects to the state of the parent.
- A nested query is selected as a scalar subquery of its packed rows rather than as a `LATERAL` join: PostgreSQL evaluates a scalar subquery of the select list after the sort and the limit of the parent, while it joins a `LATERAL` subquery to every row before them unless an index gives the order.
  On a page of 20 of 1000 parents ordered by a column without an index, the scalar subquery is 38 to 48 times faster, and the two are within 8% for all parents and for a page ordered by an index ([benchmark](benchmarks/suites/nested-placement.ts)).
- The callback of a helper defined with a query of a schema or a `Db` receives a query of its schema context in types, and at runtime the query it is applied to, whose schema shares the definitions of the relations by identity when it includes that schema.
  The callback reads relations by name from the query it is applied to, so applying a helper that selects relations of its schema context requires a query of its table under the same key with those relations, also when it is called directly.
  Relations of other schemas, such as of an independent query that the helper nests, stay in the state of the result for the `Db` to check; a helper defined with a table reads no relations.
- The PostgreSQL schema is resolved when a `Db` compiles a query, and a compiled statement never changes afterwards.
- Nested transactions use savepoints on the transaction connection, and every level run by a callback, the transaction or a savepoint, has its own context; a statement of a finished level fails and never runs in an enclosing level or on the pool.
  A level stops accepting statements before its `COMMIT`, `ROLLBACK`, `RELEASE`, or `ROLLBACK TO`.
- A level has at most one active nested level, reserved before its `SAVEPOINT` is sent, and a level run by a callback rejects its own statements and another nested level while it has one, since PostgreSQL would run them inside the nested savepoint; a test fixture preempts it instead.
- Closing a level closes all levels nested in it at once; a level whose callback settles while its nested level is still active closes it, rolls back, and rejects.
- Every level has a single cleanup: whoever ends it, such as its callback, its enclosing level, or a preemption, starts the cleanup or awaits the one already started.
  A level awaits the cleanup of its nested levels before its own.
- A failed `RELEASE` or `ROLLBACK TO` of a nested level makes the enclosing level reject its statements and nested levels and roll back at its end, since the statement may not have reached PostgreSQL.
- Starting a level rejects when its `BEGIN` or `SAVEPOINT` fails.
- Test transactions reuse the ambient transaction coordinator and always roll back.
  A test transaction runs a callback in a context created on each call, so every run and retry of a test gets its own level.
  A test wraps its body, or a Vitest `aroundEach` hook wraps the test with its other hooks, since test runners do not carry the async context of an ordinary hook into the test.
- A database created for tests rejects every statement and transaction outside a test transaction or the seed of a test fixture instead of running them on the pool.
- Late code of a timed-out test never runs in the transaction of another test, but it keeps running in its own level until that level ends or, in a fixture, is preempted.
- Test fixtures of a database created for tests form a stack of outer levels for serial tests, such as migrations for a whole test run and data of one test file: the first fixture is a transaction on a reserved connection, and each next one is a savepoint in the innermost one.
  A fixture has no context of its own.
- While a fixture is open, a test transaction started outside any transaction runs as a savepoint in the innermost fixture, so tests need no access to fixtures.
  Creating a fixture runs its seed callback in a savepoint that is released, so its changes stay in the fixture; a fixture whose seed fails rolls back and closes.
  Creating and closing a fixture are allowed only outside any transaction context, so late code of a finished level cannot reach a fixture, and a seed cannot wait for a change of the stack queued behind it.
- A fixture runs one nested level at a time, a test transaction or the next fixture; a new one preempts the active one.
  The preempted level closes at once, so its later statements fail, its statements already sent complete, and its savepoint rolls back and is released before the new level starts.
  All changes of the fixture stack, such as choosing the parent of a new level, creating, and closing a fixture, run one after another in one queue of the database.
  A failed rollback poisons the fixture, which then rejects new levels; closing it still rolls back, and closing the first fixture returns a recovered connection to the pool.
  Preemption cannot tell a timed-out test from a concurrent one, so a concurrent test of the same fixture fails instead of sharing it.
- Closing a test fixture rolls back all levels nested in it, innermost first, and then the fixture itself, as one change of the fixture stack; the closed fixtures leave the stack even if their cleanup fails.
  The closing call reports every cleanup failure of the cascade, and the first fixture releases its connection once, with a failure only if its own `ROLLBACK` failed.
- Closing an already closed fixture, including one closed with an enclosing fixture, does nothing; `close` and async disposal behave the same.
- `useTestFixture` opens its fixture in a `before` hook and closes it in an `after` hook, since the body of a `describe` block runs synchronously while the runner collects tests.
- Closing a fixture that is still opening does not wait for its seed, which may never settle: the opening rejects, the fixture and the level of its seed roll back as when a fixture closes, and a later scope opens its own fixture once the rollback completes.
  The closing reports every failure of an opening that ends after it is requested, such as a failed `BEGIN`, a rejected seed, or a failed rollback; the `before` hook of `useTestFixture` ignores the rejection of an opening that its `after` hook has already closed.
- Closing an open fixture first closes the fixtures opening in it, since `node:test` runs the `after` hook of a preload module before the one of a test file, and a seed that never settles would hold the queue of the fixture stack.
  A fixture started after a closing of an open fixture is requested opens outside of the closed fixture, so a repeated closing of the closed fixture or a closing of a fixture nested in it leaves the new fixture open.
- The `data` of a fixture throws while the fixture is not open, including after an enclosing fixture closes it.
- Objects with an explicit lifecycle, such as a database and a test fixture, are async disposable.
- Closing a database closes its test fixtures, including those still opening, and then closes the driver; closing it inside a transaction rejects, since the driver would wait for that transaction forever.
  From the first closing, statements, transactions, and fixtures started outside a transaction reject, so nothing opens after the fixtures close; the levels already running still end, and a repeated closing returns the first one.
- A cleanup error of a transaction never replaces an earlier error: it suppresses it in a `SuppressedError`.
- Result decoding rejects a driver row or a packed row that does not match the result fields instead of reading a missing value as `NULL`.
  A query of one row rejects more than one row, since it may have no limit; a `NULL` value of a query of values is `null`, not a missing row.
- Nested rows are packed as JSON in the row of their parent and decoded by the result plan of their query, at any depth:
  - Rows `many` are an array, `coalesce(json_agg(...), '[]')`, and the other rows modes are one packed row or `NULL`, which a nested query of rows `one` rejects.
    Several rows of a nested query of one row fail the statement in PostgreSQL with SQLSTATE `21000`, whose error names no field.
  - A packed row is a positional JSON array of the values of the projections in their order, also for a query of values and for a query without projections, whose `[]` differs from a missing row.
    On records of 3 to 30 fields, PostgreSQL builds it 23 to 35% faster than an object with keys, and it is 40 to 48% smaller ([benchmark](benchmarks/suites/nested-transport.ts)).
    A row wider than the limit of 100 arguments of a PostgreSQL function is built from an array of JSON values.
  - A scalar value is its PostgreSQL text representation from `format('%s', value)`, which uses the output function of the type, so one `decode` serves the values of a driver row and of a packed row alike, including extension types; an SQL array or a JSON column is a scalar too.
    A cast to `text` is not used: those of `boolean`, `inet`, `cidr`, and `char` differ from their output, such as `true` instead of `t`.
  - SQL `NULL` is JSON `null` through `IS NOT DISTINCT FROM NULL`, since `format` turns it into an empty string, and `IS NULL` also holds for a composite whose fields are all `NULL`.
  - Nested rows stay JSON inside a packed row and never pass through `format`.
  - Packing reads the projections of the nested query through a derived source, whose expressions are evaluated once per row as long as PostgreSQL does not merge the source into the aggregating query, where packing refers to a scalar twice.
    This relies on the planner, which merges no derived source with a limit, an offset, or a volatile function in its select list ([PostgreSQL](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/optimizer/prep/prepjointree.c)):
    - A volatile expression, such as `random()`, is evaluated once per row in any derived source.
    - A derived source that selects scalar expressions other than table columns gets `OFFSET 0` unless it has a limit or an offset, so that a stable expression, such as a correlated subquery, is not evaluated twice.
      The aggregating query has no conditions of its own, so the barrier keeps nothing from being pushed down, and the conditions of the nested query and their indexes stay inside the source.
      A source of table columns has no barrier, which would add up to 8% there; with `md5` of each column instead, the barrier makes the query 38 to 45% faster ([benchmark](benchmarks/suites/offset-barrier.ts)).
  - The order of the query is read from sort keys, projections of the derived source that stay out of the records, so each sort expression is evaluated once:
    - A sort key is the projection that has the value of the sort expression, as for an executed query, or a projection of the sort expression.
    - With a limit or an offset, the derived source sorts by the positions of the sort keys, such as `ORDER BY 2`, so the rows it chooses, their values, and their order in the aggregate come from one evaluation; without them, it has no order.
    - Rows `many` are aggregated in the order of the query, since the order of a derived source does not carry into an aggregate: the aggregate sorts by the sort keys with the direction and the placement of `NULL` of the query.
    - Numbering the rows with `row_number()` in the derived source and aggregating by the number would be 8 to 26% slower ([benchmark](benchmarks/suites/sort-keys.ts)), and could not sort by a window function, which PostgreSQL rejects in a window definition.
  - A decoding error names the path of the value from its result field, such as `fields[2].label`.

## Decisions

These hold for features that are not implemented yet.

- Scope predicates are never operands of a user `OR` ([orchid-orm#845](https://github.com/romeerez/orchid-orm/issues/845)).
- Mutations require an effective restriction or an explicit `all()`; a predicate simplified to `TRUE` is not a restriction ([orchid-orm#847](https://github.com/romeerez/orchid-orm/issues/847), [#854](https://github.com/romeerez/orchid-orm/issues/854)).
- An update that deletes the record its selected records reference changes only the selected records; other records that reference it only lose the reference ([orchid-orm#853](https://github.com/romeerez/orchid-orm/issues/853)).
- Settings of a level, such as its role and `set_config`, are statements on its connection, completed before its callback starts.
- After-commit hooks belong to the level that registered them: rolling the level back discards them, releasing it passes them to the enclosing level, and they run after the outermost commit.
- Migrations are fixed artifacts that never import runtime tables or types.
- Entry points of one row, such as `find` and singleton tables, start queries of one row, so `optional`, `nullable`, and `required` apply to them.

## Open questions

- Table identity: a query is tied to a table by object identity, so it cannot run against a table variant such as one with a different physical name.
  This covers tables shared between schemas that differ only in PostgreSQL schema and relations; variants would need a separate table binding concept.
- Schema views: restricted views of schemas for shared business logic are not designed yet.
- `where` predicates with joins: which source objects of column values resolve against, whether they can address joined tables, and how a callback receives the columns of joined tables.
  `SelectQuery` is typed by a single table and will need the shape of all query sources.
  A column of a source joined with `LEFT JOIN` is `NULL` without a match whatever its type, so its result type needs the nullability of the join.
- Type schemas: an unqualified type name in a cast resolves through `search_path` rather than the PostgreSQL schema of a `Db`, so `param` with such a type, such as an enum in the schema of each tenant, fails outside `search_path`.
  A type can name a fixed schema, but cannot follow the PostgreSQL schema of a `Db`.
- Singleton tables: what guarantees that a table holds at most one row, and whether that guarantee lets its mutations go without a restriction or `all()`, which the Decisions otherwise require.
- Test timeouts: a timeout alone does not close a test transaction; it closes when it is preempted or its callback settles.
  A deadline or the abort signal of a test runner, such as the one of Vitest, could close it earlier.
  A statement already sent by a preempted level or by the seed of a closed fixture delays the next level until it completes; cancelling it needs a driver capability.
- After-commit hooks in tests: hooks run after the outermost commit, and a test transaction never commits, so hooks registered by the tested code never run in a test.
  How tests run or check them is not designed yet.
- Connection loss with postgres.js 3.4.9: when a connection breaks inside a transaction, including one of its own `sql.begin`, the next statement on it throws an uncaught exception.
  Node.js terminates the process; Bun 1.4.4 reports the exception and keeps running with a pool that never settles further queries.
  The driver cannot detect the loss before that statement, so this waits for the upstream fixes of [#1199](https://github.com/porsager/postgres/issues/1199), [#1208](https://github.com/porsager/postgres/issues/1208), and [#1248](https://github.com/porsager/postgres/issues/1248).
  Releasing a lost reserved connection breaks the pool the same way, and postgres.js cannot close a reserved connection, so the driver leaves a connection that may be lost reserved; a connection that is alive in an unknown transaction state, such as after a client-side error building `COMMIT`, stays reserved too.
  `sql.end()` of postgres.js 3.4.9 never resolves when a reserved connection is released after it starts ([#1261](https://github.com/porsager/postgres/issues/1261)), so closing the driver:
  - rejects acquiring a connection once it starts;
  - waits for the reserved connections the driver will release, and for the transactions waiting for a connection; once no running transaction of the driver holds a connection, those transactions get `closeTimeout` to get one;
  - ends the client with `closeTimeout` when a connection is kept reserved or a transaction still waits, which terminates an alive kept connection and rejects the waiting transaction.
- `fetch_types: false` with postgres.js 3.4.9: the first `sql.reserve()` on a pool without an open connection never settles, so the first transaction waits until the driver closes; this waits for the upstream fix of [#1219](https://github.com/porsager/postgres/issues/1219).
