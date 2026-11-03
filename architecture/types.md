# Types and expressions

- **Type** (`type/`): a PostgreSQL type, the conversion between JavaScript values and their PostgreSQL text representation, and the operators of its expressions, shared by columns, parameters, and SQL expressions.
  PostgreSQL type parameters, such as `varchar.with(255)`, change only the SQL type name and not the cast type of parameters, so they apply at any point of a chain of type changes.
  `null` among the values of a type stands for `NULL`, which `nullable` adds, as `primaryKey`, object conditions, and `coalesce` read it, so the decoder of `transform` cannot return `null` in types; it can return `undefined`, which stays a value and reaches the decoder of a type derived from it.
  A JSON `null` value decodes to `null`, which kern-orm does not tell from `NULL`.
  Consumers require `strictNullChecks`, without which `null` belongs to every type; `primaryKey` then rejects every type and column with an error that names the option.
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

## Expression objects

- Library code builds expressions from nodes and calls no expression method except `eq` for an object condition, so a custom operator changes only its own calls and the object conditions of its type.
- Types, columns, and expressions are told apart at runtime by a brand or a class, never by their shape or `typeof`, so `sql`, `param`, and `defineTable` reject a column where a type is expected.
- The internals of an expression live under symbol keys, so operators of any name cannot replace them; the operators of a type are methods of an expression prototype created once per type.
  `withOperators` rejects an operator named `then`, which would make expressions thenable.

## Boolean logic

- Boolean logic is an expression tree; the compiler parenthesizes by tree structure, not by call order.
- `and`/`or`/`not` simplify constants only with identities valid in three-valued logic.
  An empty `IN` list is `FALSE`, an empty `and` is `TRUE`, and an empty `or` is `FALSE`.
- Built-in Boolean expressions carry the Boolean runtime type for encoding and decoding.
  Their nullability is tracked only in TypeScript: results include `null` when the expression an operator is called on or an operand expression is nullable; `isNull` and `in` with an empty list never do, and `and`/`or` include `null` when any operand does, such as a query of a condition whose value can be `NULL` ([queries](queries.md#filters)).
  The shared runtime type does not describe whether an expression can evaluate to `NULL`; result decoding preserves `NULL` independently of it.

## Parameters and SQL fragments

- PostgreSQL infers the type of every parameter from the statement text.
  `param` with a type casts its parameter to the cast type of the type, which omits type parameters such as the scale of `numeric(10,2)`, so that the operators of the type apply even where nothing else types the parameter, and type parameters do not constrain its value.
  `param` with an expression adds no cast, since operator definitions use it beside that expression, which types it.
  It returns a value that is already an expression, such as an operand of a generic operator, as it is, keeping its type, if it has one, and the nullability of its TypeScript type.
  A compared value stays without a cast, since the expression it is compared with types it, and so does a value interpolated into `sql`.
- A parameter without a type is encoded by its JavaScript type.
- A string pattern of `like` and `ilike` is PostgreSQL text and is never encoded with the type of the expression, which `transform` can give another representation; a pattern expression keeps its own encoding.
- Raw SQL fragments keep interpolations as nodes; parameters are numbered only when the complete statement is compiled, in the order of the text across nested queries.
- `sql` interpolates a query of a table without clauses, such as `db.form`, as the name of its table, which the compiler qualifies with the PostgreSQL schema of the statement and checks against the tables of a `Db`, as an occurrence of the table.
  - The name of a table of a query bound to a `Db` compiles only in a statement of that `Db`, as a nested query does.
  - It rejects a query with clauses, so that such a query can later interpolate as a subquery, and other queries, which a parameter would encode as text.
- `identifier` creates a fragment of a quoted name without parameters, so that the template of a script takes it.
  - Several names make a qualified name, such as of a schema and a table, each quoted and joined by dots.
  - It quotes each name whole and never splits it at dots, which a quoted name may contain.
  - It does not qualify the name with the PostgreSQL schema of the statement, since the name may be of any object, such as a column; a table of a `Db` interpolates as the table.
  - It requires at least one name, and every name must be a non-empty string, since PostgreSQL rejects an empty name; it checks them when it is called.
  - It takes no `undefined` for a missing schema, such as `$schemaName` of a `Db` without one, so that a name never loses its schema silently.
  - It is a function of its own, as `sql` and `param` are; Drizzle ([source](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/sql/sql.ts)) and Slonik ([docs](https://github.com/gajus/slonik#sqlidentifier)) have it as `sql.identifier`, and Kysely as `sql.id` ([docs](https://kysely-org.github.io/kysely-apidoc/interfaces/Sql.html#id)).
