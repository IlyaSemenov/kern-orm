# Tables, schemas, and Db

- **Column** (`table/column.ts`): a type with column attributes: its physical name, the key that it forms alone, the primary key or a unique key, and whether the database gives it a value when an insert omits it, as `hasDefault` marks it.
  A column is not a type: SQL fragments and parameters accept only types, and type changes such as `nullable` and `transform` precede column attributes.
  Its type tells the kind of that key: `"primaryKey"` after `primaryKey`, `"unique"` after `unique`, `undefined` for a type without attributes or after `columnName` of a type, and a union where the type does not tell, such as `Column<T>`.
  A column forms one key at most: `primaryKey` and `unique` reject a column that forms a key, in types and at runtime, and in types also a column whose type does not tell its key.
  Its type tells whether it has a default: `true` after `hasDefault`, `false` for a type without attributes, and `boolean` where the type does not tell, such as `Column<T>`, which an insert requires unless the column is nullable.
- **Table** (`table/`): immutable descriptor of a physical table name, its columns, and its keys, with no relations, PostgreSQL schema, or database connection.
  `defineTable` accepts types and columns and turns each type into a column without attributes.
  A column is found only under an own key of the columns: a lookup ignores properties inherited from the object prototype, such as `toString`.
  - A key of one column is marked on its column, and a key of several columns is listed in the options of `defineTable`, so that each key has one place.
    `defineTable` rejects several columns marked with `primaryKey`, a primary key both on a column and in the options, a key of the options with fewer than two columns or with an unknown or repeated column, a nullable column of the primary key, and two keys of the same columns in any order.
  - `keys` of a table holds the primary key, or `undefined`, and the unique keys, those of the columns in their order followed by those of the options, as frozen lists of column keys; a primary key of the options keeps its order.
  - Keys state what the database guarantees, by a constraint, a unique index, or the query of a view; kern-orm creates no constraints from them.
  - A table declared with `singleton: true` in the options of `defineTable` holds at most one row, which a unique index of `(true)` must guarantee, which [the table check](#table-check) verifies, and queries of the table start as queries of that row ([queries](queries.md#queries-of-a-singleton-table)).
    - It is an option rather than a key without columns, such as `unique: [[]]`, which would read as a key that matches every row ([decision](../decisions/schemas/singleton-tables.md)).
    - `singleton` of a table tells it, and `defineTable` rejects an option that is not a boolean.
    - The type of a table tells it by its parameter `Singleton`: `true` or `false` of a literal option, `false` without it, and `boolean` where the types do not tell it: for an option that is not a literal, such as of a variable of type `TableOptions`, for a union of options of different values, which may include `undefined`, and for a table typed as `Table<Name, Columns>`.
  - The type of a table tells its keys by `TableKeys`, from the types of its columns and its options, and gives `AnyTableKeys`, which tells none, where the types do not tell them: for a column whose type does not tell its key, for several columns marked with `primaryKey`, for options whose keys are not tuples of single column keys, such as with a union in a key or in the list of unique keys, and for a table typed as `Table<Name, Columns>`.
    A union of options gives the union of their keys; the options of `defineTable` are a required parameter of its second overload, so that options that may be `undefined` give the keys of the columns as one of them.
  - `TableKeys` holds the keys only in a member that takes and returns them, so that it is invariant in them, and that is required and named by an unexported symbol, so that no assignment gives a table more or fewer keys, and a type that drops the member, such as `Pick` of `primaryKey` and `unique`, tells no keys.
    Its members `primaryKey` and `unique` have the types of `AnyTableKeys`, so that intersecting it with `AnyTableKeys`, as the `this` types of query methods do, compares no tuples.
  - `defineTable` computes the keys of a table before writing them as the arguments of `TableKeys`, since a deferred type reference, or a type parameter that `infer` leaves for `never`, makes the type of a table generic, which TypeScript instantiates with the query states over it again on each call, such as of `$execute` ([benchmark](../benchmarks/types/queries.bench.ts)).
  - `createTableFactory` creates a function of the type of `defineTable`, so that an application gives a convention of its tables in one place; a table outside the convention takes the plain `defineTable`.
    Its `columnName` callback maps a column key to its physical name.
    It applies only to columns without an explicit `columnName()`, creating copies so that shared columns remain unchanged.
    Applications can use `toSnakeCase` or supply another conversion, such as for a legacy database.
    - The callback is called once for each such column and must return a non-empty string, which the table checks, since PostgreSQL rejects an empty name only when a query runs.
    - The option belongs to the definition of tables rather than to a database, since a table knows no database and has one set of physical names in every schema ([decision](../decisions/schemas/column-naming-conventions.md)).
    - `toSnakeCase` (`table/snake-case.ts`) starts a word at a capital letter after a lowercase letter or a digit, so that digits stay in their word.
      A run of capital letters is one word, such as `user_id` for `userID`, and its last letter starts the next word before a lowercase letter, such as `json_data` for `JSONData`, unless that letter is an `s` that ends the key, a plural, such as `user_ids` for `userIDs`.
      Case does not tell a plural before another word from a word such as `Is`, as in `url_is_valid` for `URLIsValid`, so a key such as `IDsList`, which gives `i_ds_list`, requires `columnName`, and so does one that mixes cases in a word, such as `serverIPv4`, which gives `server_i_pv4`.
    - Only column names are derived, since `defineTable` takes the name of its table.
    - A derived physical name must differ from the physical name of every other column of the table, such as with keys `formId` and `form_id`, since two keys would silently read one column.
      Duplicate names set with `columnName` are allowed, as in `defineTable`.
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
  - A relation `one` is required only when `one` sets `required: true`, since only a foreign key or another guarantee of the database, which kern-orm does not know, ensures the record: without its record, a query of a required relation without a filter rejects, and of a relation that is not required gives `null`; a relation `many` is not required.
  - `$relations` rejects a required relation with a column `from` that is nullable by `isNullable` of its type, since a record with a `NULL` key has no related record; types do not check it, since `one` does not always know its source table, such as outside `$relations`.
  - In types, `required` of type `boolean` gives query results with `null`, as when the relation is not required, and `required` typed as an optional property, which may be missing at runtime, gives the union of its value and `false`.
- **Db** (`execution/db.ts`): a schema bound to a database and a PostgreSQL schema; it compiles and executes queries over the tables of its schema.
  `bindSchema` creates it from a `Database` of the database layer, which knows no schemas, so that code without schemas, such as the migrator, takes the same database.
  The PostgreSQL schema is resolved when a `Db` compiles a query, and a compiled statement never changes afterwards.
  `$schemaName` resolves it when read, calling the function of `schemaName` as compiling a query does, and is `undefined` for a `Db` bound without one.
  `$database` is the database that a `Db` is bound to, typed as the `Database` of the layer, so that code given the `Db` of an application, such as a migrator or a script that closes the database, needs nothing else and nothing of the ORM.
  - `bindSchema` also takes a function that returns the database, such as of dependency injection, so that a module-level `Db` runs on the database of the current context, as `schemaName` resolves its schema.
    The `Db` calls it in the async context of the caller for each statement, including a query of SQL text when it executes, at the start of `$transaction`, `$ensureTransaction`, `$session`, `$lock`, `$tryLock`, and `$pollLock`, and when `$isInTransaction()`, `$isInTransactionBlock()`, or `$database` is read; never when a database is created, a schema is bound, or a query is built or compiled.
    The methods that return a promise reject, rather than throw, when the function throws.
    It rejects a result that is not a database by `isDatabase`, such as `undefined` of a missing provider.
  - The function must return the same database within a transaction or session.
    Inside the callback of `$transaction`, `$ensureTransaction`, or `$session` of the `Db`, also of `$ensureTransaction` that joins a transaction of the database, a call for which the function returns another database rejects; outside such a callback, such as in a transaction of the database or of another `Db`, it is not checked ([decision](../decisions/schemas/database-of-the-current-context.md)).
    `DbOf` types the `Db` of a schema, and a `Db` of every schema that includes it fits that type, since the types of entries and relations accept more tables and relations, so code shared by several schemas takes such a `Db` as a parameter.
    Comparing two `Db` types compares the states of the queries of their entries, since a query is covariant in its state; the methods of a `Db` and a schema are generic or typed by `this`, so that comparing them compares no queries.

Members of schemas and `Db` other than tables start with `$`, and table keys must not.
Column keys must not start with `$` either, which keeps such names free for members of the column references passed to query callbacks.

## Table check

`findTableMismatches` (`inspection/tables.ts`, exported from `kern-orm/testing`) resolves to the mismatches of the tables of a `Db` and its PostgreSQL schema, each with the key of its table in the schema and a message, so that a test compares them with an empty list in any test runner and filters out those of a table it accepts.

- It reads `pg_catalog` through `$database` of the `Db`, so that it runs in the ambient transaction, such as a test transaction in which migrations have created the tables, and in the PostgreSQL schema that `$schemaName` gives, read once, or `current_schema()` for a `Db` bound without one.
  `information_schema` omits unique indexes that no constraint creates, such as partial ones and those of expressions, and hides objects by privileges.
- It requires PostgreSQL 17, for `to_regtypemod`, and rejects on an older server before reading the catalog.
  It reads the columns of PostgreSQL 18, `conenforced` and `conperiod`, from the row of `pg_constraint` as JSON, so that the statement runs on PostgreSQL 17, which lacks them.
- Each table exists as a table, ordinary, partitioned, or foreign, or as a view, ordinary or materialized, with each column under its physical name; columns of one physical name are each checked.
- Each column is of its `sqlType`: `to_regtype` and `to_regtypemod` resolve it in the search path of the connection, as the casts of queries resolve a type, and `format_type` of the result is compared with that of the column, so that aliases, such as `int4` and `integer`, match, and type modifiers, such as of `varchar(255)`, must match.
- Only the columns and their types of a view are checked, since the catalog tells neither the nullability of its columns nor what its query guarantees; a required relation of a view is not checked.
- A column of a table whose type is nullable has no not-null constraint, and one whose type is not nullable has a valid one: on PostgreSQL 18, `attnotnull` is also true for a `NOT VALID` not-null constraint, which rejects `NULL` of new rows but not of existing ones.
- A column marked with `hasDefault` has a default, an identity, or a generated value; a default of a column without it is not a mismatch, since it breaks no insert or query of the table.
- A column of a table that the table does not define is a mismatch only when it has a not-null constraint, valid or not, and no such value, since every insert of the table fails on it.
- Each key of a table is backed by the unique indexes that PostgreSQL infers as the arbiters of the target of `ON CONFLICT` that `onConflict` and `upsert` build for it: of the set of its columns in any order, ignoring `INCLUDE` columns and repeated columns, without expressions or a predicate, and valid ([decision](../decisions/schemas/backing-of-keys.md)).
  One of them must exist, and none may be deferrable, since PostgreSQL rejects an insert with a deferrable arbiter even beside one that is not.
  A singleton table is backed by such an index of the single expression `(true)`.
- Each required relation `one` between tables is backed by a foreign key of the same pairs of columns, compared as a set, that is valid, enforced, not deferrable, and not of a period, since a deferrable one allows a missing record within a transaction.
- A message names a column by its key, followed by its physical name when it differs, and a key by its column keys.

## Open questions

- Table identity: a query is tied to a table by object identity, so it cannot run against a table variant such as one with a different physical name.
  This covers tables shared between schemas that differ only in PostgreSQL schema and relations; variants would need a separate table binding concept.
- Type schemas: an unqualified type name in a cast resolves through `search_path` rather than the PostgreSQL schema of a `Db`, so `param` with such a type, such as an enum in the schema of each tenant, fails outside `search_path`.
  A type can name a fixed schema, but cannot follow the PostgreSQL schema of a `Db`.
- Long names: PostgreSQL truncates a table or column name of more than 63 bytes, with a notice on every statement, so two names that share their first 63 bytes name one table or column; whether `defineTable` rejects such a name, whose length in bytes depends on the server encoding.
