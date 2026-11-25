# Types and expressions

- **Type of the database layer** (`type/` of `kern-db`): the contract by which the database layer converts the values of a PostgreSQL type: its SQL type and cast type, the conversion between JavaScript values and their PostgreSQL text representation, and nullability.
  - Both packages name their type `Type` and its function `defineType`, as `kern-db/types` and `kern-orm/types` export their built-in types under the same names ([decision](../decisions/types/type-names-of-both-packages.md)).
    The ORM imports those of `kern-db` as `DbType`, `defineDbType`, and `isDbType`; the root of `kern-orm` re-exports only the types of `kern-db` whose names it does not declare itself, such as `TypeOptions` and `DerivableType`, and `kern-orm/db` all of them.
    So a consumer that cannot resolve `kern-db`, as with pnpm, names a type of `kern-db` whose name the root declares, such as `TypeOutput` in the signature of `get` of a query, only in a program that loads `kern-orm/db`.
  - `Type` of `kern-db` has only these members, without the methods that derive types, so that an API that takes a type infers its values from them alone.
  - `encode` and `decode` are properties of function types rather than methods, whose parameters TypeScript compares bivariantly, so a type is not a type of more accepted values, such as of numbers for `text`.
    They must not read `this`, so that an object that copies them calls the same functions.
  - `defineType` of `kern-db` creates a `DerivableType`, which adds `nullable`, `nullableAs`, `transform`, `of`, and `withParameters`, and, once `withParameters` gave it a format, `with`; each returns a derivable type, by the rules of the same methods of a type of the ORM, except that its `nullableAs` applies whatever the values of the type, and that of the ORM only to values that include `null` ([values of `NULL`](#values-of-null)).
    It rejects a type, also of the ORM, in place of its options, in types and at runtime, since it would take only its SQL type names and lose its conversion and nullability.
  - A type is told from other objects at runtime by its brand, never by its shape.
    Its brand and members are own enumerable properties, so that an object that copies them, with members of its own, is a type too.
    A type that `defineType` or a derivable type creates is frozen.
  - A type may declare a read expression, `read` of the options of `defineType`: a function from the SQL text of an expression of its PostgreSQL type to the SQL text that reads it, such as `extract(epoch from value)`, whose result `decode` decodes instead of the value ([decision](../decisions/types/read-expression-of-a-type.md)).
    - It is the member `read` of the contract, `undefined` for a type whose values are read as they are; the types derived with `transform`, `nullable`, `of`, and `with` keep it, and so does an object that copies the members of a type, such as a type of the ORM.
    - It is SQL text rather than a `sql` fragment, so it has no parameters, and the [columns of a record](sql-queries.md#columns-of-records) give it in their text; `defineType` rejects an option that is not a function or does not return a string.
    - It must not read `this`, must give the same SQL for the same value, and must write the value once in it, whatever the value: a statement writes the SQL of the value at each place, so two would evaluate it twice, such as a volatile expression that a query selects.
      `defineType` calls it with a sample value and rejects SQL that has the sample another number of times, which finds the mistake early but does not check every value.
      An expression that needs the value at several places calls a PostgreSQL function of one argument; a scalar subquery of the value would evaluate a value that refers to no row, such as `random()`, once for the statement.
    - The expression takes the value in the PostgreSQL type of the expression that a query reads, which is wider than the type of the column where PostgreSQL computes it in another type, such as the `numeric` average of `integer` values, as `decode` takes the text of that type.
    - A statement must select a value of such a type by the expression wherever it returns the value: the columns of a record and the [queries of the ORM](sql.md#read-expressions) do, and a statement of SQL text written by hand must select it itself.
    - The expression must be `NULL` for `NULL` and for no other value: decoding reads `NULL` without `decode`, packing tests the value itself, and the columns of a record tell a missing row by the `NULL` of the result columns of their key, so a column of a key may have such a type.
    - The built-in types have none, so the SQL of their queries does not depend on it.
    - `array` rejects an element type with one, since the expression does not apply to the elements of an array; it rejects when it is called, since the values of a type do not tell its expression in types.
  - A nullable type may decode `NULL` to a value other than `null`, by the function that `nullableAs` takes, which returns the value, such as `undefined`, which tells `NULL` of a `jsonb` value from a JSON `null` value ([decision](../decisions/types/null-decoded-to-a-value.md)).
    - It is the member `decodeNull` of the contract, `undefined` for a type whose `NULL` is `null`; an object that copies the members of a type keeps it, such as a type of the ORM.
      `decodeNull` of the layer (`type/type.ts`) returns what `NULL` decodes to with a type, which every place that decodes a value calls for `NULL` alone, so a value other than `NULL` costs nothing more: a flat result, a `NULL` element of `array`, and the result of a builder, which takes it from `kern-db/builder`.
    - The function is called for each `NULL`, so it can return a new object each time; it must not read `this`, must not return `null`, and must return its value synchronously, since decoding is synchronous, which types check.
      At runtime, `decodeNull` of the layer rejects a thenable that it returns, such as of an async function, so that it fails decoding rather than leaving a Promise in the result, as a callback of `map` of a query does ([converting results](queries.md#converting-results)); a value other than `NULL` does not reach the check.
    - It changes only what a result returns: the type accepts `null`, which a parameter passes as `NULL`, and rejects `undefined` as every parameter does, also when it returns `undefined` for `NULL`.
    - The values that such a type returns do not tell in types what its `NULL` decodes to, also when they have no `null`, such as `string | undefined` of `text`, so a type derived from them would return `null` for `NULL` in types.
      So its `transform`, `of`, `nullable`, and `nullableAs` reject when they are called, and `nullableAs` must be the last change of the values of a type; `withParameters` and `with` keep it.
    - `nullableAs` is a method of its own rather than an overload of `nullable` ([decision](../decisions/types/null-decoded-to-a-value.md)).
    - The values of `decode` in types include the value of `decodeNull`, since the contract types both by the values that the type returns.
  - The built-in types live in `type/builtins/`, under their names; a built-in type of `kern-orm/types` is `defineType` of the ORM of the type of `kern-db/types` with the operators of the type.
    `array` of the layer builds only the representation of an array of a type, whose `NULL` elements decode as its element type decodes `NULL`, and the type of the ORM adds `equalityOperators` when its element type has them; `enum` of the layer narrows its values with `of`, and the type of the ORM adds `orderingOperators`.
  - The decoder of a built-in type converts the text that PostgreSQL writes for its type and does not validate it: it rejects only text that it cannot convert, such as of another `DateStyle` or a multidimensional array, and text that a check costing next to nothing tells from the value that it would otherwise read, such as `true` that `boolean` would read as `false`.
    Result decoding wraps its error in `ResultDecodeError`.
    Other text, such as `1e3` of an `integer`, decodes to whatever the conversion reads, since a check of the format would cost for each value and only text from a source other than PostgreSQL, such as a fake driver, fails it.
    - `boolean` accepts only `t` and `f`.
    - The one-dimensional array decoder reads a quoted element in slices separated by backslash escapes, so a run of ordinary characters costs one slice ([decision](../decisions/types/quoted-array-elements.md)).
    - Date and time decoders reuse the ISO date and local time fields where PostgreSQL returns them in output order, padding seconds to microseconds and converting the session offset to UTC for `timestamptz` ([decision](../decisions/types/decoding-dates.md)).
    - `bytea` rejects text with an odd number of hex digits, whose last digit it would lose, and text that its conversion does not decode in full, and does not check the digits otherwise.
      It converts hex by the native hex methods of `Uint8Array`, or by `Buffer` of `node:buffer` on a runtime that lacks them, such as Node.js 24, and returns a `Uint8Array` on both ([decision](../decisions/types/hex-of-bytea.md)).
  - `jsonWithJsonNull` and `jsonbWithJsonNull` (`type/builtins/json.ts`) are the `json` and `jsonb` values in which a top-level JSON `null` value is the marker `jsonNull`, so that `null` among their values is only `NULL`, which `nullable` adds ([decision](../decisions/types/json-null-marker.md)).
    - Their values without a shape are `{}`, both returned and accepted, the TypeScript type of every value other than `null` and `undefined`, which includes the marker.
      A shape of `of` has the marker only when its values include it, such as `Payload | JsonNull`, since `of` narrows only in types.
    - They decode a value that parses to `null` to the marker, whatever its text, which `json` keeps as written, such as with spaces, and leave a `null` inside a value as it is.
    - Only the marker encodes to a JSON `null` value: they reject another value that JSON writes as a top-level `null`, such as `NaN` or an object whose `toJSON` returns `null`, which would be read back as a marker that its shape may not name.
      A marker inside a value is not checked, which would cost a call for each of its values: JSON leaves it out of an object and writes it as `null` in an array.
    - `json` and `jsonb` decode a JSON `null` value to `null` and reject the marker when encoding, with an error that names the types that write it.
    - The marker is a symbol, which no JSON value is and which `===` narrows in both branches of a shape that names it apart from its other values, such as `Payload | JsonNull`.
      It is a symbol of `Symbol.for`, so that it is one value in every copy of `kern-db` ([compatibility](compatibility.md)).
      Neither JSON nor structured cloning carries a symbol, so a result must convert the marker where it leaves the application.
    - The roots of `kern-db` and `kern-orm` export `jsonNull` and its type `JsonNull`, and so do their `types` entry points, whose declarations name it.
- **Type of the ORM** (`type/` of `kern-orm`): a PostgreSQL type, the conversion between JavaScript values and their PostgreSQL text representation, and the operators of its expressions, shared by columns, parameters, and SQL expressions.
  A type of the ORM is a type of the database layer with operators and the factories of columns.
  `defineType` of the ORM creates a type from the options of `defineType` of `kern-db`, from a derivable type of `kern-db`, such as one defined without the ORM, or from another type of the ORM; it keeps the values and the type parameters of the type it takes, without the operators of a type of the ORM.
  PostgreSQL type parameters, such as `varchar.with(255)`, change only the SQL type name and not the cast type of parameters, so they apply at any point of a chain of type changes.
  `nullable` adds `null` to the values that a type returns and accepts, where it stands for `NULL`, as `coalesce`, object conditions, and the results of operators read it, so the decoder of `transform` cannot return `null` in types; it can return `undefined`, which stays a value and reaches the decoder of a type derived from it.
  A type is nullable when it accepts `null`, which a query always passes as `NULL`: `primaryKey`, the keys of a table, `of`, and `transform` read nullability from the values that a type accepts rather than from those that it returns ([decision](../decisions/types/nullability-of-accepted-values.md)), so an `encode` of `transform` that takes `null`, also as `unknown`, makes the type nullable.
  At runtime, only `nullable` and `nullableAs` set `isNullable`, which `defineTable` and `$relations` check, since a function does not tell the values it takes.
  - The values of `json` and `jsonb` are `unknown`, which includes a JSON `null` value: it decodes to `null`, which kern-orm does not tell from `NULL` unless the type [decodes `NULL` to a value](#values-of-null).
    They accept `{}`, the values other than `null` and `undefined`, so that only `nullable` and `nullableAs` make them nullable.
  - For such values, `coalesce` keeps `unknown`, and the result of an operator includes `null`, such as of `eq` of a `jsonb` column that is not nullable, until `of` declares a shape, which has no `null`.
    Consumers require `strictNullChecks`, without which `null` belongs to every type; `primaryKey` then rejects every type and column with an error that names the option.
    `of<T>()` of a type narrows the values that it returns and accepts to `T` only in types, and returns the type itself at runtime, since values are not validated ([decision](../decisions/types/narrowed-values.md)); it rejects a type that [decodes `NULL` to a value](#values-of-null).
  - `T` must be among the values that the type both returns and accepts, since a narrowed value reaches its encoder; a type that accepts none of the values it returns, such as one whose `transform` decodes text into numbers without `encode`, rejects every `T` with an error that names the reason.
  - `nullable` adds `null` before or after `of`, which keeps it beside `T`.
  - Generic operators, such as `eq`, `in`, and `lt`, read `T` from the expression, while an operator defined as a function keeps the values of the type it was added to, and a pattern of `like` stays a string.
  - `enum` narrows its values with `of` rather than with an identity `transform`, which would call a decoder for each value.
  - `jsonWithJsonNull` and `jsonbWithJsonNull` tell a JSON `null` value from `NULL` by a marker instead, so their values have no `null` apart from `NULL`, also without a shape, and the rules of the `unknown` values of `json` and `jsonb` do not apply to them.
    Their expressions are typed as those of any type whose values have no `null`: `eq` of a `jsonbWithJsonNull` column that is not nullable with `jsonNull` is `boolean`, and includes `null` only when its operand can be `NULL`; `jsonWithJsonNull` has no `eq`, as `json` has none.
    Types reject `nullableAs` of them in the ORM, as of every type whose values have no `null` apart from `NULL`; the runtime does not tell the values of a type.
  - A type copies the members of its type of the database layer with the brand, so the database layer takes a type of the ORM wherever it takes its own, and `encode` and `decode` of a type are the functions of its type of the layer, without a call of the type for each value.
  - `nullable`, `transform`, `withParameters`, and `with` of a type derive its type of the database layer and give the result the operators of the type as they are, so an operator defined as a function is wrapped once, by the `withOperators` that added it.
  - `Type` of the ORM declares the members of `Type` of `kern-db` and these methods itself rather than inheriting them, which would cost instantiations for each type derived in user code ([decision](../decisions/types/db-type-members-of-a-type.md)); type tests check that a type of the ORM is assignable to `Type` of `kern-db`.
  - A type of the database layer is not a type of the ORM, which `isType` of the ORM tells by a brand of its own: `sql`, `param`, `caseWhen`, and `defineTable` reject it in types and at runtime, with an error that names `kern-orm/types` and `defineType` of `kern-orm`.
- **Expression** (`expression/`): public wrapper over an expression node and its type, with operators, `and`/`or`/`not`, `sql`/`param` fragments, and functions such as `coalesce` and `caseWhen`.
  Every expression has `isNull`; the operators of its type are added to it and replace `isNull` if one has its name, in types and at runtime alike.
  SQL `=` is a capability of a type given only by the operators of `equalityOperators`, which `orderingOperators` include; these operators are marked, so that another operator named `eq` does not give it, and an array type has them only when its element type has the capability.
  Two types are compared with `=` as they are, as the keys of a relation, when both have the capability and they are one SQL type by their cast types, whatever their type parameters and the representation of their values, or both belong to an explicit family of one B-tree operator family: `smallint`, `integer`, and `bigint`, or `text` and `varchar`.
  Equal TypeScript types are not enough, such as of `uuid` and `text`, which PostgreSQL does not compare.
  An object condition matches a column by calling the `eq` operator of its type, whichever operator it is, and accepts the values of its single operand; it matches `null` with `IS NULL` without calling operators.
  It is typed by the values it returns and the values it accepts in comparisons, which differ for types such as `timestamptz`, which also accepts a `Date`.
  An operator defined as a function receives expressions of the type that `withOperators` was called on, even on a type derived from it, so its arguments keep that encoding and its `self` has the operators its definition was typed with.
  A generic operator from `defineGenericOperator`, such as `lt` of `orderingOperators`, receives the expression with its own type; its method is typed by an `OperatorSignature` interface that reads the value types of the expression and the operators of its type from `this`, because TypeScript cannot instantiate a generic function type.
  Its `Self` constraint checks which types can receive it through `withOperators`, independently of its method signature on derived types; the implementation accepts any expression because `transform` can change the value representation.
  An expression without a type, such as `sql<T>`, has `isNull` and the operators of `equalityOperators`, because a TypeScript type does not determine a SQL type.

## Values of `NULL`

- A type of `nullableAs` returns the value of its function for every `NULL` that it decodes, and takes `null` as `NULL` as every nullable type does.
  - A result has the value wherever the type decodes it: a field of a column or of an expression of the type, in the row of a statement and in a packed row, the value of `get` and `pluck`, and `NULL` of an expression that has the type, such as of `param` of the type with `null`.
    The type of a sum of `smallint` and `integer` values keeps `decodeNull` of its argument, so that a sum decodes `NULL` as the other aggregates of its values do.
  - A missing row is told apart from the type: nested rows of rows `nullable` are `null` and of rows `optional` `undefined` without their row, whatever their value decodes `NULL` to.
    A query of `get` of rows `optional` of a type that decodes `NULL` to `undefined` resolves to `undefined` for both, which a record of the row tells apart.
  - Queries pass `NULL` as `null`: an insert, an update, an object condition, `param`, and the plain `null` of `caseWhen`; `undefined` keeps its meaning, a column that an insert omits and an update keeps, and no parameter.
    So a query cannot pass the value that such a type returns for `NULL` back as `NULL`.
    A query passes `null` to `json` and `jsonb` as `NULL` too, so a JSON `null` value is written on purpose by a `sql` fragment, or by `jsonNull` of `jsonWithJsonNull` and `jsonbWithJsonNull`.
- Types tell that an expression can be `NULL` by `null` among its values, so `nullableAs` of a type of the ORM applies only when the values of the type include `null` beside that of `NULL`, such as the `unknown` values of `json` and `jsonb` without a shape of `of`, which keep `null` beside the value of `decodeNull`.
  - The expressions of such a type are typed as those of the type of `nullable`: the result of an operator, such as `eq`, includes `null`, and `coalesce` keeps `unknown`.
  - Types reject another type, such as `text`, `jsonb` with a shape, `jsonbWithJsonNull`, or a type of `transform`, whose values would have no `null`, with an error that names the reason: the result of an operator of another type, such as `eq` or `length`, would be typed without `null` although it is `NULL` when the expression is.
    The runtime does not tell the values of a type, so only types reject it.
    The result of the method is typed as the reason too, so that the method passed as a callback, whose `this` types do not check, gives no type of the ORM.
  - The result of the method for values without `null` is typed as the reason and as a `DerivableType` of the database layer, which has no operators and which a table rejects, so that `nullableAs` does not keep a type of the ORM from a function of derivable types, such as `t.text` from a parameter of `DerivableType<string>`.
    Typed as a `DerivableType`, a type of the ORM applies `nullableAs` whatever its values and returns a type of the ORM at runtime.
  - `defineType` of the ORM rejects a type that decodes `NULL` to a value when it is called, also a type of the ORM, since it does not check the values; `nullableAs` of the type that it defines applies when its values include `null`.
    A type of the database layer has no expressions, so its `nullableAs` applies whatever its values.
  - Lifting the restriction needs nullability apart from the values, which the [backlog](../backlog/passing-a-value-as-null.md) keeps.

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
  The shared runtime type does not describe whether an expression can evaluate to `NULL`; result decoding reads `NULL` independently of it.

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
  - A call is a raw node, as `createList` makes those of the other functions.

## Aggregate functions

- `count`, `countDistinct`, `min`, `max`, `sum`, `avg`, `every`, `some`, and `stringAgg` (`expression/aggregates.ts`) are [functions of expressions](#functions-of-expressions) whose call is an `aggregate` node, of the definitions that the aggregate methods read from `query/aggregate.ts`; [queries](queries.md#aggregate-functions) tell what a query that holds one does.
- The argument is what the first operand of a function is: an expression with a type or a query of one value, in types and at runtime.
  `count` takes a call without an argument as `count(*)` and rejects an argument of `undefined`, which would count the rows silently.
  `stringAgg` requires a delimiter after it, as the method does.
- Each takes options as its last argument: `filter`, and for `stringAgg` also `orderBy`.
  - `filter` is a Boolean expression or a query of one Boolean value, the condition of the rows that the function takes, compiled as `FILTER (WHERE ...)` after the call; an object of column values, which `where` resolves against its table, has no table there, so types and the runtime reject it.
  - `orderBy` takes `OrderTerms`, as the callback of `orderBy` of a query returns them, compiled as `ORDER BY` in the call; without it, `stringAgg` joins the values in an order that PostgreSQL chooses, and the other functions take no order, since their values do not depend on it.
  - At runtime, `count` takes a plain object as its options and any other value as its argument, and each function rejects options other than a plain object and a key other than its options, so that an object of column values passed instead of an argument, such as `count({ status: "approved" })`, rejects rather than counts every row.
  - The aggregate methods take no options: `where` chooses the rows of a method, and `stringAgg` of a query joins them in the order of the query.
- The values follow the aggregate methods: `count` and `countDistinct` give a number, and the others the value of the argument or `null`, also without rows that `filter` takes.
  The type of the expression is the one of the method, so it decodes the value and gives it its operators; `sum` of `smallint` and `integer` values rejects a sum outside the safe integer range of numbers, and `avg` of a type of the cast type `bigint`, and `sum` of `smallint` and `integer` values of a type with a read expression, reject when they are called.
  Types do not check that PostgreSQL has the aggregate for the type of the argument, as for the methods.
- An overload without a filter marks an aggregate with its argument value for direct selection in a [query of groups](queries.md#groups).
  Operators and functions do not carry this mark; an aggregate expression retains its standalone nullable value when used outside a grouped selection.

## Text functions

- `lower`, `upper`, `trim`, and `length` of `textOperators` are operators rather than [functions](#functions-of-expressions), since they have a single operand and only text types have them.
- The result of `lower`, `upper`, and `trim` is an expression of `text`, and of `length` of `integer`, whatever the type they are called on, since PostgreSQL returns these types for `varchar`, `char`, and `citext` too, and a decoder of `transform` expects values that it encoded rather than results of a function.
  It is `NULL` when the expression can be.
- `trim` removes only spaces, as `btrim` of one argument does, rather than all whitespace.
- `length` counts what PostgreSQL stores: the characters of the text encoded by the type, without the trailing spaces of `char`.
- `type/text.ts` and `type/number.ts` create `text` and `integer` on first use, as `type/boolean.ts` creates `boolean`, since text operators and these types depend on each other.

## Arithmetic operators

- `add`, `sub`, `mul`, and `div` of `arithmeticOperators` (`expression/operators/arithmetic.ts`) are the SQL `+`, `-`, `*`, and `/` of an expression with an operand, and `exactArithmeticOperators` add `mod`, the SQL `%`.
  - The built-in integer types and `numeric` have `exactArithmeticOperators`, and `real` and `doublePrecision` `arithmeticOperators`, since PostgreSQL has no `%` of floating-point types.
  - They are generic operators of a binary node, of any SQL operator of a value, which the compiler parenthesizes by the precedence of its operator in PostgreSQL rather than as a raw node, which a page after an offset would take for a fragment of a user.
  - They can be added only to types of numbers, bigints, or strings, which types check without telling a string of a decimal number from text.
- The result has the type of the expression the operator is called on, as the first operand of a [function](#functions-of-expressions) gives it, so it decodes the result, gives it its operators, and encodes a plain operand, which takes no cast, as a compared value; it is not read from the types of both operands ([decision](../decisions/expressions/arithmetic-result-type.md)).
  - An operand is what an operand of `lt` is: a value that the type accepts, or an expression or a query of one value of the values of the expression.
    Types check the values of an operand rather than its SQL type, as for the operands of functions, so they take `doublePrecision` beside `integer`, whose values are both numbers, and reject `bigint` beside `integer`, which requires `sql`.
  - PostgreSQL computes the result in the common type of the operands, so dividing integers truncates the quotient, and the type of the expression reads the value in that type, as the first operand of a function does.
  - Its values widen the literals of the values of the expression to `number`, `bigint`, or `string`, since a result is not one of the literals that `of` narrowed them to; a value of `transform` of another kind stays as it is, and so does `undefined` that its decoder returns.
  - It is `NULL` when the expression or the operand can be.
- An increment of a column is `add` in the callback of `update`, without a method of a mutation of its own ([decision](../decisions/mutations/increment-as-an-operator.md)).

## Vector distances

- `vector` (`type/builtins/vector.ts` of both packages) is the type of pgvector, a built-in type although PostgreSQL has it only with the extension `vector`, whose values are arrays of numbers in the text representation `[1,2.5,1e-05]`, which is JSON.
  - It decodes with `JSON.parse`, which is faster than splitting the text, and rejects JSON other than an array, which would be another kind of value, without checking its elements, and encodes with `join`, so that PostgreSQL rejects a `NaN` or an infinite element with the error of pgvector rather than reads the `null` that JSON writes for it.
  - Its type of the ORM has `equalityOperators`, since pgvector has `=` for it, and `vectorOperators`, without `orderingOperators`, whose order of vectors has no use.
- `l2Distance`, `negativeInnerProduct`, `cosineDistance`, and `l1Distance` of `vectorOperators` (`expression/operators/vector.ts`) are the SQL `<->`, `<#>`, `<=>`, and `<+>` of pgvector of an expression with an operand, as a binary node, which the compiler parenthesizes as any operator other than arithmetic.
  - They compile to the operators rather than to the functions of pgvector, such as `l2_distance`, since only an operator in `ORDER BY` can use an index of pgvector.
  - `negativeInnerProduct` is the value of `<#>` as it is, the inner product with its sign changed, under a name that tells the sign ([decision](../decisions/expressions/negative-inner-product.md)).
- An operand is what an operand of `lt` is, encoded by the type of the expression without a cast, which PostgreSQL resolves to the type of the expression, so that the operators apply to any vector type of pgvector, such as `halfvec` that users define.
  Types do not restrict the types that take them, since the type of the expression encodes the operand whatever its values.
- The result is an expression of `doublePrecision`, which pgvector returns for every distance, so it has the operators of numbers, such as `lt` of a distance within which a query keeps the rows.
  It is `NULL` when the expression or the operand can be.

## Parameters and SQL fragments

- PostgreSQL infers the type of every parameter from the statement text.
  `param` with a type casts its parameter to the cast type of the type, which omits type parameters such as the scale of `numeric(10,2)`, so that the operators of the type apply even where nothing else types the parameter, and type parameters do not constrain its value.
  `param(type, value)` creates a typed constant expression that queries can select; kern-orm exports no constants of other types than the Boolean `TRUE` and `FALSE`.
  `param` with an expression adds no cast, since operator definitions use it beside that expression, which types it.
  It returns a value that is already an expression, such as an operand of a generic operator, as it is, keeping its type, if it has one, and the nullability of its TypeScript type.
  A query of one value, such as an operand of a generic operator, becomes an expression with the runtime type of the first argument; types give it as an `AnyExpression` of the value of the query, which is `NULL` without its row whatever that type ([queries](queries.md#queries-in-expressions)).
  A compared value stays without a cast, since the expression it is compared with types it, and so does a value interpolated into `sql`.
- A parameter without a type is encoded by its JavaScript type, by the rule of the [database layer](#sql-fragments-of-the-database-layer): it takes a string, a number, a bigint, a Boolean, `null`, a `Date`, or a `Uint8Array`, and JSON and arrays take `param` with a type.
  - `sql`, and so `$query` and `$script`, reject any other value when the template is created, so that the error points at the template.
  - The compiler rejects it in a parameter node of any origin when the statement compiles.
- A string pattern of `like` and `ilike` is PostgreSQL text and is never encoded with the type of the expression, which `transform` can give another representation; a pattern expression keeps its own encoding.
- Raw SQL fragments keep interpolations as nodes; parameters are numbered only when the complete statement is compiled, in the order of the text across nested queries.
- `sql` interpolates a query of a table without clauses, such as `db.form`, as the name of its table, which the compiler qualifies with the PostgreSQL schema of the statement and checks against the tables of a `Db`, as an occurrence of the table.
  - The name of a table of a query bound to a `Db` compiles only in a statement of that `Db`, as a nested query does.
- `sql` interpolates another query of a table, of any rows and value, as a query in an expression, which keeps its `Db` ([queries](queries.md#queries-in-expressions)): a query of one value is its value, as an operand is, and another query its statement in parentheses, `(SELECT ...)`, which the text reads, such as with `EXISTS` or `IN` or in `FROM`.
  - The text must name the columns of a subquery in `FROM` after its alias, in the order of the fields of the query other than literals, such as `AS form (field_count)`, rather than by the SQL names of its projections, which differ from the keys of long fields.
  - PostgreSQL 18 parses a subquery in further parentheses as a subquery, such as in `EXISTS ((SELECT 1))`, `1 IN ((SELECT 1 UNION SELECT 2))`, `1 = ANY ((SELECT 1 UNION SELECT 2))`, and `FROM ((SELECT 1))`, so the text may put the query in parentheses of its own.
  - A query of `exists` is `EXISTS` of its rows rather than its statement, `(SELECT EXISTS (...))`, which PostgreSQL evaluates as a subquery for each row of a condition instead of joining the rows as a semi-join.
  - It rejects a query of `$select`, a [query of `map` or `transform`](queries.md#converting-results), a mutation, and a query of SQL text.
- `identifier` creates a fragment of a quoted name without parameters, so that the template of a script takes it.
  - It is an expression of the fragment of `identifier` of the [database layer](#sql-fragments-of-the-database-layer), which quotes the names.
  - Several names make a qualified name, such as of a schema and a table, each quoted and joined by dots.
  - It quotes each name whole and never splits it at dots, which a quoted name may contain.
  - It does not qualify the name with the PostgreSQL schema of the statement, since the name may be of any object, such as a column; a table of a `Db` interpolates as the table.
  - It requires at least one name, and every name must be a non-empty string, since PostgreSQL rejects an empty name; it checks them when it is called.
  - It takes no `undefined` for a missing schema, such as `$schemaName` of a `Db` without one, so that a name never loses its schema silently.
  - It is a function of its own, as `sql` and `param` are ([decision](../decisions/expressions/identifier-function.md)).
- `joinSql` joins items into one raw node, separated by `, ` or by a separator, an expression such as a fragment of `sql`, or a fragment of the database layer.
  - An item is what the template of `sql` interpolates, through the same function.
  - It copies the text and the values of a raw node of an item or of the separator into the node, which interpolation leaves without parentheses anyway, so that a list does not nest a node per item.
  - Its type argument declares the TypeScript type of the node, as that of `sql` does, so that the list is a condition inside `where`.
  - It rejects an empty array, as `joinSql` of the [database layer](#sql-fragments-of-the-database-layer) does.

## SQL fragments of the database layer

- `sql`, `joinSql`, `identifier`, `literal`, `unsafeSql`, and `param` of the database layer (`sql/fragment.ts`) create a `SqlFragment`: text with parameters, quoted names, literals, and nested fragments, without expressions, operators, or a type of its value.
  `kern-db` exports them, and `kern-orm/db` re-exports them; both and the root of `kern-orm` export the types `SqlFragment` and `SqlValue`, which the templates of `query` and `script` of a `Database` and of `queryOn` name.
- The template of `sql` takes a fragment, which stays SQL, and the value of a parameter without a type: a string, a number, a bigint, a Boolean, `null`, a `Date`, or a `Uint8Array`.
  - Its types reject any other value, such as an object, an array, or an expression of the ORM, and it rejects them when it is created, with an error that names no ORM: only a type tells how PostgreSQL reads an object or an array.
  - JSON and arrays take `param` with a type.
- `joinSql` joins items into one fragment, separated by `, ` or by a separator fragment.
  - An item is what the template of `sql` takes: a fragment stays SQL, and another value becomes a parameter, also with its check when it is called.
  - It copies the text and the values of the separator and of each fragment into one fragment, so that rendering does not recurse into a fragment per item; the values keep the parameter of a `param` as the same object, which a statement binds once.
  - It rejects an empty array when it is called, since PostgreSQL rejects an empty list in most places of a list, such as `VALUES` and `IN` ([decision](../decisions/expressions/join-sql-function.md)).
- `literal` creates a fragment of the SQL literal of a value, without parameters, for the places where PostgreSQL takes no parameter, such as the values of `ALTER`, `COMMENT`, and `SET`, and the template of a script ([decision](../decisions/expressions/literal-and-unsafe-sql.md)).
  - It takes the values that a parameter takes without a type, and writes the literal when it is called, so the fragment has the value as it is then, and an error points at the call.
  - A string is a quoted literal with its quotes doubled, and one with a backslash an escape string with its backslashes doubled, `E'...'`, as `quote_literal` of PostgreSQL writes it, so that the literal keeps its value whatever `standard_conforming_strings` is.
    It rejects a string with a NUL character, which PostgreSQL takes neither in text nor in a statement, and takes any other string as a parameter does, also one with a lone surrogate, which a driver replaces when it encodes the statement or the parameter.
  - A `Date` is the quoted literal of its ISO text and a `Uint8Array` of its hex, the texts of their parameters, which PostgreSQL types by the place of the literal as it types a parameter; it rejects an invalid `Date`.
  - A number and a bigint are their digits without quotes, since places such as `RESTART WITH` take only a numeric constant, a Boolean is `TRUE` or `FALSE`, and `null` is `NULL`.
    It rejects a number that is not finite, which has no numeric constant, and an integer number beyond the safe integers, whose digits may differ from those that the code wrote and which takes a bigint.
  - A negative number is its minus and its digits, without parentheses, which the places of a numeric constant reject, so a template must put a number in parentheses of its own in an expression: after a minus, the minus of the number would start a comment, and a cast binds tighter than it.
  - A template must interpolate the fragment in place of a value: inside a quoted string, a dollar-quoted string, or a comment of the template, a value can end what surrounds it.
    It must separate the fragment from a word before it, such as by a space after a keyword, since the `E` of an escape string would continue the word.
- `unsafeSql` creates a fragment of its text as it is, without parameters, such as of a type with its modifiers or of a comment; it checks only that the text is a string, so the caller answers for the text, which must hold no input of a user.
- `param` takes a type, also of the ORM, and the values that the type accepts, and casts its parameter to its cast type, as `param` of the ORM does.
  - The cast is in parentheses, since text after it could continue its type name, such as a subscript `[1]` after `integer[]`.
- The [columns of a record](sql-queries.md#columns-of-records) are a fragment of a class of their own, `SqlColumns`, which extends `SqlFragment`, so that every template takes them as a fragment.
  The constructor of `SqlFragment` freezes a fragment of any other class, also of a class of another package that extends it.
- A fragment is immutable and holds the values of its parameters by reference: rendering encodes them with `encodeParameter` (`sql/parameter.ts`), which also encodes the parameters of the ORM, and rejects `undefined` and a value that a parameter does not take without a type, so a fragment created without these functions cannot pass one.
- `renderFragment` renders a fragment into SQL text with a `ParameterBinder`, which takes each parameter in the order of the text and returns its placeholder, so that the code that compiles the statement numbers the parameters.
  - A binder takes the parameter of `param` with a key, the same object wherever a statement repeats the fragment, so that it can bind the parameter once.
  - `compileFragment` compiles a fragment as a statement of its own, and `compileScript` as the text of a script, which rejects every parameter.
  - `compileFragment` binds the parameter of a `param` fragment once, under one placeholder wherever the statement repeats the fragment, since its cast types it the same at every place; it binds another value at each place, since PostgreSQL types it by its place.
    It looks the key up by the identity of the fragment, so two calls of `param` with the same value are two parameters, and it keeps the first `param` apart and creates a map of the others at the second, so that a statement of at most one `param` creates no map ([decision](../decisions/sql/parameters-of-casts.md)).
- The ORM interpolates a fragment of the layer into `sql`, and so into `$query` and `$script`, as a `fragment` node, which the compiler renders with its compile context as the binder.
  - Its parameters are numbered with those of the statement, and the statement binds the parameter of its `param` once, as that of a cast node ([SQL generation](sql.md#statements)), so a template gives the same statement through `$query` as through `query` of a `Database`.
  - Only these templates and `joinSql` take a fragment: an operand of an operator or a function takes an expression.
