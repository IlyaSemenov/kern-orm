# Helpers

Build the steps of typical changes, such as creating a table or an index, with helpers: each helper builds the SQL of the change together with the SQL that undoes it.

```ts
import { addColumn, createIndex, defineMigration } from "kern-migrations"

export default defineMigration([
  addColumn("form", "slug", "text"),
  createIndex("form", ["slug"], { unique: true }),
])
```

Pass the names of tables, columns, indexes, constraints, sequences, and enum types without quotes: helpers quote them.
Pass definitions, conditions, defaults, and the columns of an index as SQL, quoting a name in them where SQL needs it, such as `'"order"'`.
When you build SQL text from values of your code, quote names with `quoteIdentifier` and strings with `quoteLiteral`, both from `kern-migrations`.

- Tables: `createTable(table, columns, { constraints })`, `dropTable` with the same arguments, and `renameTable(from, to)`.
- Columns: `addColumn(table, column, definition)`, `dropColumn` with the same arguments, `renameColumn(table, from, to)`, and `changeColumn(table, column, from, to)`.
- Indexes: `createIndex(table, columns, options)` and `dropIndex` with the same arguments; the options are `name`, `unique`, `nullsNotDistinct`, `using`, `include`, `where`, and [`concurrently`](./outside-transaction).
- Constraints: `addConstraint(table, name, definition)`, `dropConstraint` with the same arguments, and `changeConstraint(table, name, from, to)`.
- Sequences: `createSequence(name, options)` and `dropSequence` with the same arguments, `renameSequence(from, to)`, and `changeSequence(name, from, to)`; the options are `type`, `increment`, `minValue`, `maxValue`, `start`, `cache`, and `cycle`.
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

## Drop a table, column, index, constraint, sequence, or enum type

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

## Index names

`createIndex` names an index as PostgreSQL names an index without a name, such as `form_name_idx`, and `dropIndex` with the same arguments finds it.
Pass `name` for an index of expressions, such as `["lower(email)"]`.

## Extensions

`createExtension` creates an extension unless the database has it, and rolling back keeps it, since other schemas may use it.
Create the extension in a schema of its own and list that schema in `searchPath` of the migrations, so that the migrations find it whatever schema they apply to, such as the schema of each [tenant](../orm/multiple-schemas) or the schema where [`verifyMigrations`](./testing) checks them:

```ts
createExtension("pg_trgm", { schema: "extensions" })
```

It creates the schema too when the database lacks it, and rolling back keeps the schema with the extension.
