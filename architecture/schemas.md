# Tables, schemas, and Db

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
  - `defineTable` computes the keys of a table before writing them as the arguments of `TableKeys`, since a deferred type reference, or a type parameter that `infer` leaves for `never`, makes the type of a table generic, which TypeScript instantiates with the query states over it again on each call, such as of `$execute` ([benchmark](../benchmarks/types/queries.bench.ts)).
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
    `one` rejects a key `to` typed as a union only when all of its columns together include no key of the target, and a target typed as a union of tables only when no table of the union has a key among them.
  - A relation `one` is required only when `one` sets `required: true`, since only a foreign key or another guarantee of the database, which kern-orm does not know, ensures the record: without its record, a query of a required relation rejects, and of a relation that is not required gives `null`; a relation `many` is not required.
  - `$relations` rejects a required relation with a column `from` that is nullable by `isNullable` of its type, since a record with a `NULL` key has no related record; types do not check it, since `one` does not always know its source table, such as outside `$relations`.
  - In types, `required` of type `boolean` gives query results with `null`, as when the relation is not required, and `required` typed as an optional property, which may be missing at runtime, gives the union of its value and `false`.
- **Db** (`execution/db.ts`): a schema bound to a database and a PostgreSQL schema; it compiles and executes queries over the tables of its schema.
  The PostgreSQL schema is resolved when a `Db` compiles a query, and a compiled statement never changes afterwards.
  `DbOf` types the `Db` of a schema, and a `Db` of every schema that includes it fits that type, since the types of entries and relations accept more tables and relations, so code shared by several schemas takes such a `Db` as a parameter.
  Comparing two `Db` types compares the states of the queries of their entries, since a query is covariant in its state; the methods of a `Db` and a schema are generic or typed by `this`, so that comparing them compares no queries.

Members of schemas and `Db` other than tables start with `$`, and table keys must not.
Column keys must not start with `$` either, which keeps such names free for members of the column references passed to query callbacks.

## Open questions

- Table identity: a query is tied to a table by object identity, so it cannot run against a table variant such as one with a different physical name.
  This covers tables shared between schemas that differ only in PostgreSQL schema and relations; variants would need a separate table binding concept.
- Schema views: restricted views of schemas for shared business logic are not designed yet.
- Type schemas: an unqualified type name in a cast resolves through `search_path` rather than the PostgreSQL schema of a `Db`, so `param` with such a type, such as an enum in the schema of each tenant, fails outside `search_path`.
  A type can name a fixed schema, but cannot follow the PostgreSQL schema of a `Db`.
- Singleton tables: what guarantees that a table holds at most one row, and whether that guarantee lets its mutations go without a restriction or `all()`, which the [Decisions](README.md#decisions) otherwise require.
