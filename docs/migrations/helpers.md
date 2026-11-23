# Schema Helpers

Build the steps of typical changes, such as creating a table or an index, with helpers: each helper builds the SQL of the change together with the SQL that undoes it.

```ts
import { addColumn, createIndex, defineMigration } from "kern-migrations"

export default defineMigration([
  addColumn("form", "slug", "text"),
  createIndex("form", ["slug"], { unique: true }),
])
```

Pass the names of tables, columns, indexes, constraints, sequences, enum types, views, functions, and parameters without quotes: helpers quote them.
Pass definitions, conditions, defaults, the columns of an index, and the queries of views as SQL, quoting a name in them where SQL needs it, such as `'"order"'`.
The old query of `replaceView` and the query of `dropView` must give the columns that the view has.
When the view was created of `SELECT *` and the table has gained columns since, list the columns of the view in them.
When you build SQL text from values of your code, quote names with `quoteIdentifier` and strings with `quoteLiteral`, both from `kern-migrations`.

- Tables: `createTable(table, columns, options)` and `dropTable` with the same arguments, and `renameTable(from, to)`; the options are `constraints` and `singleton`, which creates the singleton index of the table too.
- Columns: `addColumn(table, column, definition)`, `dropColumn` with the same arguments, `renameColumn(table, from, to)`, and `changeColumn(table, column, from, to)`.
- Indexes: `createIndex(table, columns, options)` and `dropIndex` with the same arguments; the options are `name`, `unique`, `nullsNotDistinct`, `using`, `include`, `where`, and [`concurrently`](./outside-transaction).
- Singleton indexes: `createSingletonIndex(table, { name })` and `dropSingletonIndex` with the same arguments, a unique index of `(true)` that keeps a table to at most one row, such as a [singleton table](../orm/singleton-tables) of the ORM.
- Constraints: `addConstraint(table, name, definition)`, `dropConstraint` with the same arguments, and `changeConstraint(table, name, from, to)`.
- Sequences: `createSequence(name, options)` and `dropSequence` with the same arguments, `renameSequence(from, to)`, and `changeSequence(name, from, to)`; the options are `type`, `increment`, `minValue`, `maxValue`, `start`, `cache`, and `cycle`.
- Views: `createView(name, query, options)` and `dropView` with the same arguments, and [`replaceView(name, from, to, options)`](#replace-the-query-of-a-view); the options of all three are `checkOption`, `securityBarrier`, and `securityInvoker`, and `replaceView` also takes [`rollback`](#replace-the-query-of-a-view).
- Functions: [`createFunction(name, parameters, definition)`](#create-a-function) and `dropFunction` with the same arguments, and [`replaceFunction(name, parameters, from, to)`](#replace-the-definition-of-a-function).
- Enum types: `createEnum(name, values)` and `dropEnum` with the same arguments; pass the values without quotes, such as `createEnum("user_role", ["admin", "member"])`.
- Extensions: `createExtension(name, { schema })`.

For a change that no helper covers, write a [step of SQL](./writing#sql-steps), or [a helper of your own](./custom-helpers) to reuse it in several migrations.

## Change a column

Pass `changeColumn` the column before and after the change: the `type`, `notNull`, and `default` that change, each in both states, with `default: null` for no default.
When the type of a column with a default changes, give `default` in both states even when it stays the same, so that the default is set again for the new type.
To convert the values to a new type, give the state its `using` expression:

```ts
changeColumn(
  "form",
  "position",
  { type: "text", using: "position::text", default: "''" },
  { type: "integer", using: "position::integer", default: "0" },
)
```

Applying converts the values with `using` of the second state, and rolling back with that of the first.

## Replace the query of a view

Pass `replaceView` the query of the view before and after the change, and the options of the view, if it has any:

```ts
replaceView(
  "public_form",
  "SELECT id, name FROM form",
  "SELECT id, name FROM form WHERE published",
  { securityInvoker: true },
)
```

Applying replaces the query with `CREATE OR REPLACE VIEW`, which keeps the grants, comment, and triggers of the view, and fails when the target schema has no such view.
It also replaces the options of the view with those of the step, so give every option that the view has.
The new query must give the columns of the view with the same names, types, and collations in the same order, and may add columns after them.
To change the columns otherwise, drop the view with `dropView` and create it again with `createView`.

Rolling back restores the previous query, which fails when the new query adds columns, since PostgreSQL cannot drop the columns of a view by replacing its query.
For such a change, pass `rollback: "recreate"`:

```ts
replaceView("public_form", "SELECT id FROM form", "SELECT id, name FROM form", {
  rollback: "recreate",
})
```

Rolling back then drops the view and creates it again from the old query.
The view loses its grants, comment, and triggers, and rolling back fails when other views depend on it.

## Create a function

Pass `createFunction` the parameters of the function by name, and the rest of the function after its parameters.
Give a parameter as its type, such as `"text"`, or as an object of:

- `type`: the type of the parameter, such as `"jsonb"`;
- `mode`: `"in"`, the default, `"out"`, `"inout"`, or `"variadic"`;
- `default`: the SQL value that a call without the parameter takes, such as `"null"`.

```ts
createFunction(
  "enqueue",
  {
    task: "text",
    payload: { type: "jsonb", default: "null" },
    id: { mode: "out", type: "bigint" },
  },
  `LANGUAGE sql
  BEGIN ATOMIC
    INSERT INTO job (task, payload) VALUES (enqueue.task, enqueue.payload) RETURNING job.id;
  END`,
)
```

Rolling back drops the function by the types of its parameters, so it drops this function and keeps its overloads.
It fails when other objects depend on the function, such as a trigger.

## Replace the definition of a function

Pass `replaceFunction` the parameters of the function and its definition before and after the change:

```ts
replaceFunction(
  "add",
  {
    a: "integer",
    b: "integer",
  },
  "RETURNS integer LANGUAGE sql IMMUTABLE RETURN a + b",
  "RETURNS integer LANGUAGE sql IMMUTABLE RETURN coalesce(a, 0) + coalesce(b, 0)",
)
```

Applying replaces the definition with `CREATE OR REPLACE FUNCTION`, which keeps the owner and grants of the function and the objects that depend on it, and fails when the target schema has no such function.
Rolling back restores the previous definition the same way.
Give the parameters that the function has: both directions keep them.
To change what `CREATE OR REPLACE FUNCTION` cannot change, such as the types of the parameters or the return type, drop the function with `dropFunction` and create it again with `createFunction`.

## Drop a table, column, index, constraint, sequence, view, function, or enum type

Pass a drop helper the definition of what it drops: rolling back creates it again from the definition.

Dropping a table or a column also drops its indexes and constraints.
To restore those that the definition does not describe, drop them with their own steps before it:

```ts
export default defineMigration([
  dropIndex("form", ["slug"], { unique: true }),
  dropColumn("form", "slug", "text"),
])
```

Rolling back does not restore the values of a dropped column, so it fails for a column with `NOT NULL` and without a default when the table has rows.
To drop such a column, give it a default first: rolling back adds the column with the default, which fills the rows, and then drops the default:

```ts
export default defineMigration([
  changeColumn("form", "slug", { default: null }, { default: "''" }),
  dropColumn("form", "slug", "text NOT NULL DEFAULT ''"),
])
```

Describe each constraint once: in the definition, or by a step of its own.
An index of a `PRIMARY KEY` or `UNIQUE` constraint goes with its constraint.

Rolling back a dropped sequence creates it again from its `start` rather than from its current value.

Rolling back a dropped view does not restore its grants, comment, and triggers, and rolling back a dropped function does not restore its grants and comment.

## Index names

`createIndex` names an index as PostgreSQL names an index without a name, such as `form_name_idx`, and `dropIndex` with the same arguments finds it.
Pass `name` for an index of expressions, such as `["lower(email)"]`.

`createSingletonIndex` names an index `<table>_singleton_idx`.
Pass `name` when the name that a helper gives would be longer than 63 bytes, which PostgreSQL truncates.

## Extensions

`createExtension` creates an extension unless the database has it, and rolling back keeps it, since other schemas may use it.
Create the extension in a schema of its own and list that schema in `searchPath` of the migrations, so that the migrations find it whatever schema they apply to, such as the schema of each [tenant](../orm/multiple-schemas) or the schema where [`verifyMigrations`](./testing) checks them:

```ts
createExtension("pg_trgm", { schema: "extensions" })
```

It creates the schema too when the database lacks it, and rolling back keeps the schema with the extension.
