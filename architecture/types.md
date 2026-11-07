# Types and expressions

- **Type** (`type/`): a PostgreSQL type, the conversion between JavaScript values and their PostgreSQL text representation, and the operators of its expressions, shared by columns, parameters, and SQL expressions.
  PostgreSQL type parameters, such as `varchar.with(255)`, change only the SQL type name and not the cast type of parameters, so they apply at any point of a chain of type changes.
  `null` among the values of a type stands for `NULL`, which `nullable` adds, as `primaryKey`, object conditions, and `coalesce` read it, so the decoder of `transform` cannot return `null` in types; it can return `undefined`, which stays a value and reaches the decoder of a type derived from it.
  A JSON `null` value decodes to `null`, which kern-orm does not tell from `NULL`.
  Consumers require `strictNullChecks`, without which `null` belongs to every type; `primaryKey` then rejects every type and column with an error that names the option.
- **Expression** (`expression/`): public wrapper over an expression node and its type, with operators, `and`/`or`/`not`, `sql`/`param` fragments, and functions such as `coalesce` and `caseWhen`.
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

## Expression objects

- Library code builds expressions from nodes and calls no expression method except `eq` for an object condition, so a custom operator changes only its own calls and the object conditions of its type.
- Types, columns, and expressions are told apart at runtime by a brand or a class, never by their shape or `typeof`, so `sql`, `param`, and `defineTable` reject a column where a type is expected.
- The internals of an expression live under symbol keys, so operators of any name cannot replace them; the operators of a type are methods of an expression prototype created once per type.
  `withOperators` rejects an operator named `then`, which would make expressions thenable.

## Boolean logic

- Boolean logic is an expression tree; the compiler parenthesizes by tree structure, not by call order.
- `and`/`or`/`not` simplify constants only with identities valid in three-valued logic.
  An empty `IN` list is `FALSE`, an empty `and` is `TRUE`, and an empty `or` is `FALSE`.
- `TRUE` and `FALSE` (`expression/constants.ts`) are Boolean expressions of the constant nodes, so every position of a condition or an expression takes them, and `or` drops `FALSE` and `and` drops `TRUE`, as the neutral branch of a condition built in code.
  - A condition takes no plain Boolean value, since TypeScript types the negation of an expression, such as `!form.published`, as `false`, so that types would accept it and the condition would silently lose its branch.
  - Creating them reads the Boolean type, so they have a module of their own, which no module of the import cycle of expressions imports.
- Built-in Boolean expressions carry the Boolean runtime type for encoding and decoding.
  Their nullability is tracked only in TypeScript: results include `null` when the value of the expression an operator is called on or of an operand can be `NULL`, such as of a nullable column, of a query of `get` without its row, or among the values of a query of `in`.
  `isNull` and `in` with an empty list never include it, and `and`/`or` include it when any operand does, such as a query of a condition whose value can be `NULL` ([queries](queries.md#queries-in-expressions)).
  The shared runtime type does not describe whether an expression can evaluate to `NULL`; result decoding preserves `NULL` independently of it.

## Functions of expressions

- `coalesce`, `greatest`, and `least` (`expression/functions.ts`) are functions of their operands rather than operators of a type, since each type has them and their first operand may be a query, which has no operators.
- The first operand gives the result its type, which decodes its values and gives it its operators; it requires an expression with a type or a query of one value, whose projection has the type, in types and at runtime.
  The type encodes the plain values among the following operands.
  They take no cast, since PostgreSQL types a parameter by the other operands, and a first operand always types them.
- A following operand is what an operand of an operator is ([queries](queries.md#queries-in-expressions)): a value that the type encodes, or an expression or a query of one value of the values of the first operand.
  - It rejects a plain `null` and `undefined`, in types and at runtime, as the method `coalesce` of a query does, since a function skips `NULL` and a parameter has no `undefined`.
- Types check the values of the operands rather than their SQL types, as for the operands of operators.
  PostgreSQL resolves the common type of the operands ([PostgreSQL](https://www.postgresql.org/docs/current/typeconv-union-case.html)) and rejects operands without one, such as `text` and `uuid`.
  - No runtime check compares the cast types of the operands, as it would reject operands whose common type the first operand reads, such as a count, a `bigint` decoded as a number, beside an `integer`, which is the common case of aggregates beside columns.
  - The type of the first operand reads the value in the common type, so it fails to decode with `ResultDecodeError` where the formats differ, such as a `timestamp` before a `timestamptz`, so the wider type must come first.
  - For the same reason, an `integer` before a count reads a value outside the safe integer range of numbers without the error of a count.
- The result is `NULL` only when every operand can be, as PostgreSQL gives for each of them, which types follow.
  An array of following operands may be empty, so it does not make a nullable first operand a value other than `NULL`.
  The following operands are `const`, since TypeScript otherwise widens a literal of a union of literals, such as of an enum, which fails the constraint and leaves the constraint itself, whose operands can be `NULL`; a plain array, which the mutable values of an array type do not take as `const`, keeps `null` in the same way, unlike the expression of `param`.
- Unlike the method `coalesce` of a query, which keeps a missing row missing, a query among the operands of `coalesce` is `NULL` without its row, as in any expression, so the function replaces a missing row too.
- A call is a raw node of `createList`, so lowering takes it for a SQL fragment in a page after an offset ([SQL generation](sql.md#nested-rows)), which only costs the speed of the page.
- A call of a function adds about 70 instantiations to a query of a column and about 140 to one of an aggregate of a relation ([benchmark](../benchmarks/types/queries.bench.ts)).
- `caseWhen` is a searched SQL `CASE` expression of its branches in order, of a type given as its first argument rather than read from an operand, since its values are often plain values, which have no SQL type.
  - The type decodes the result and gives it its operators.
    It casts each plain value to the cast type, as `param` with a type does, since PostgreSQL resolves `CASE` of parameters alone as `text`, whose `max` compares strings, so that `50` is above `100`.
    An expression or a query keeps its SQL type, and types check its values, so the [common type](#functions-of-expressions) of the values applies as it does for the other functions.
  - The value of a branch and the fallback also take a plain `null`, which has an effect here, unlike among the operands of `coalesce`.
  - The result type includes `null` without a fallback or when a branch value or the fallback can be `NULL`; a nullable type alone does not add `null`.
    The fallback is an overload of its own rather than an optional parameter, so that types reject a fallback that may be `undefined`, which would omit `ELSE`.
    Its values are `const`, as the following operands of the other functions are, for the same reason.
  - A condition is a predicate or a query of one Boolean value, at runtime too; an object of column values has no table here, and a plain Boolean value is a matter of the code that builds the branches.
  - Without branches, which PostgreSQL rejects in `CASE`, it is the fallback, or `NULL` of its type, so that a list built in code may be empty, as those of `and` and `or` may.
  - Simple `CASE x WHEN ...` is not offered: `x.eq(...)` in each condition writes it.
  - A call is a raw node, as `createList` makes those of the other functions, and adds about 410 instantiations to a query of a column for two branches with their conditions ([benchmark](../benchmarks/types/queries.bench.ts)).

## Aggregate functions

- `count`, `countDistinct`, `min`, `max`, `sum`, `avg`, `every`, and `some` (`expression/aggregates.ts`) are [functions of expressions](#functions-of-expressions) whose call is an `aggregate` node, of the definitions that the aggregate methods read from `query/aggregate.ts`; [queries](queries.md#aggregate-functions) tell what a query that holds one does.
- The argument is what the first operand of a function is: an expression with a type or a query of one value, in types and at runtime.
  `count` takes a call without an argument as `count(*)` and rejects an argument of `undefined`, which would count the rows silently.
- The values follow the aggregate methods: `count` and `countDistinct` give a number, and the others the value of the argument or `null`.
  The type of the expression is the one of the method, so it decodes the value and gives it its operators; `sum` of `smallint` and `integer` values rejects a sum outside the safe integer range of numbers, and `avg` of a type of the cast type `bigint` rejects when it is called.
  Types do not check that PostgreSQL has the aggregate for the type of the argument, as for the methods.
- A query of one field of `count()` takes about 250 instantiations, of `max` of a column about 310, and of `max` of an aggregate of a relation about 600 ([benchmark](../benchmarks/types/queries.bench.ts)).

## Text functions

- `lower`, `upper`, `trim`, and `length` of `textOperators` are operators rather than [functions](#functions-of-expressions), since they have a single operand and only text types have them.
- The result of `lower`, `upper`, and `trim` is an expression of `text`, and of `length` of `integer`, whatever the type they are called on, since PostgreSQL returns these types for `varchar`, `char`, and `citext` too, and a decoder of `transform` expects values that it encoded rather than results of a function.
  It is `NULL` when the expression can be.
- `trim` removes only spaces, as `btrim` of one argument does, rather than all whitespace.
- `length` counts what PostgreSQL stores: the characters of the text encoded by the type, without the trailing spaces of `char`.
- `type/text.ts` and `type/number.ts` create `text` and `integer` on first use, as `type/boolean.ts` creates `boolean`, since text operators and these types depend on each other.

## Parameters and SQL fragments

- PostgreSQL infers the type of every parameter from the statement text.
  `param` with a type casts its parameter to the cast type of the type, which omits type parameters such as the scale of `numeric(10,2)`, so that the operators of the type apply even where nothing else types the parameter, and type parameters do not constrain its value.
  `param(type, value)` creates a typed constant expression that queries can select; kern-orm exports no constants of other types than the Boolean `TRUE` and `FALSE`.
  `param` with an expression adds no cast, since operator definitions use it beside that expression, which types it.
  It returns a value that is already an expression, such as an operand of a generic operator, as it is, keeping its type, if it has one, and the nullability of its TypeScript type.
  A query of one value, such as an operand of a generic operator, becomes an expression with the runtime type of the first argument; types give it as an `AnyExpression` of the value of the query, which is `NULL` without its row whatever that type ([queries](queries.md#queries-in-expressions)).
  A compared value stays without a cast, since the expression it is compared with types it, and so does a value interpolated into `sql`.
- A parameter without a type is encoded by its JavaScript type.
- A string pattern of `like` and `ilike` is PostgreSQL text and is never encoded with the type of the expression, which `transform` can give another representation; a pattern expression keeps its own encoding.
- Raw SQL fragments keep interpolations as nodes; parameters are numbered only when the complete statement is compiled, in the order of the text across nested queries.
- `sql` interpolates a query of a table without clauses, such as `db.form`, as the name of its table, which the compiler qualifies with the PostgreSQL schema of the statement and checks against the tables of a `Db`, as an occurrence of the table.
  - The name of a table of a query bound to a `Db` compiles only in a statement of that `Db`, as a nested query does.
- `sql` interpolates another query of a table, of any rows and value, as a query in an expression, which keeps its `Db` ([queries](queries.md#queries-in-expressions)): a query of one value is its value, as an operand is, and another query its statement in parentheses, `(SELECT ...)`, which the text reads, such as with `EXISTS` or `IN` or in `FROM`.
  - The text must name the columns of a subquery in `FROM` after its alias, in the order of the fields of the query other than literals, such as `AS form (field_count)`, rather than by the SQL names of its projections, which differ from the keys of long fields.
  - PostgreSQL 18 parses a subquery in further parentheses as a subquery, such as in `EXISTS ((SELECT 1))`, `1 IN ((SELECT 1 UNION SELECT 2))`, `1 = ANY ((SELECT 1 UNION SELECT 2))`, and `FROM ((SELECT 1))`, so the text may put the query in parentheses of its own.
  - A query of `exists` is `EXISTS` of its rows rather than its statement, `(SELECT EXISTS (...))`, which PostgreSQL evaluates as a subquery for each row of a condition instead of joining the rows as a semi-join.
  - It rejects a query of `$select`, a [query of `map` or `transform`](queries.md#converting-results), a mutation, and a query of SQL text, which a parameter would encode as text.
- `identifier` creates a fragment of a quoted name without parameters, so that the template of a script takes it.
  - Several names make a qualified name, such as of a schema and a table, each quoted and joined by dots.
  - It quotes each name whole and never splits it at dots, which a quoted name may contain.
  - It does not qualify the name with the PostgreSQL schema of the statement, since the name may be of any object, such as a column; a table of a `Db` interpolates as the table.
  - It requires at least one name, and every name must be a non-empty string, since PostgreSQL rejects an empty name; it checks them when it is called.
  - It takes no `undefined` for a missing schema, such as `$schemaName` of a `Db` without one, so that a name never loses its schema silently.
  - It is a function of its own, as `sql` and `param` are; Drizzle ([source](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/sql/sql.ts)) and Slonik ([docs](https://github.com/gajus/slonik#sqlidentifier)) have it as `sql.identifier`, and Kysely as `sql.id` ([docs](https://kysely-org.github.io/kysely-apidoc/interfaces/Sql.html#id)).
