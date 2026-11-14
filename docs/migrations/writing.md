# Writing Migrations

Write each change of your database, such as a new table or column, as a migration of steps that [helpers](./helpers), such as `createTable`, build together with the SQL that undoes them.
Put each migration in its own module and export its steps with `defineMigration`, building them with helpers:

```ts [src/migrations/0001_create_form.ts]
import { createIndex, createTable, defineMigration } from "kern-migrations"

export default defineMigration([
  createTable("form", {
    id: "uuid PRIMARY KEY DEFAULT gen_random_uuid()",
    name: "text NOT NULL",
    published: "boolean NOT NULL",
  }),
  createIndex("form", ["name"]),
])
```

The steps apply in order, and rolling back the migration undoes them in reverse order.

Name each module `<number>_<name>`, such as `0001_create_form.ts`, with a number of its own: the numbers order the migrations.
[`new`](./cli#create-a-migration) of the command line creates the module with the next number.

Write names without a PostgreSQL schema, such as `form` rather than `app.form`: migrations run with the search path of the schema they apply to, so the same migrations apply to any schema.

Use the database names of tables and columns, such as `form_id` for the key `formId` mapped by a [naming convention](../orm/schemas#naming-conventions).
Migration helpers and SQL use these names directly.

Do not import the tables, custom types, or database of your application into a migration: a migration must do the same on every database and in every later version of the application.

## SQL steps

For a change that no helper covers, such as filling a new column, write a step of SQL: `up` applies the change, and `down` undoes it.
Put it among the helpers of a migration:

```ts [src/migrations/0003_add_form_slug.ts]
import { addColumn, changeColumn, createIndex, defineMigration } from "kern-migrations"

export default defineMigration([
  addColumn("form", "slug", "text"),
  { up: "UPDATE form SET slug = regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')" },
  changeColumn("form", "slug", { notNull: false }, { notNull: true }),
  createIndex("form", ["slug"], { unique: true }),
])
```

Leave out `down` of a step that cannot be undone, such as a change of data: rolling back skips it.

A migration of a single step, such as a view, can export the step without an array:

```ts
export default defineMigration({
  up: "CREATE VIEW published_form AS SELECT * FROM form WHERE published",
  down: "DROP VIEW published_form",
})
```

### Code in a migration

When a step needs code, such as to compute values from existing rows, pass a function instead of SQL.
It receives the database of the migration, whose `query`, `script`, and `execute` run in the transaction of the migration:

```ts
import { addColumn, changeColumn, defineMigration } from "kern-migrations"
import * as t from "kern-orm/db/types"

const toSlug = (name: string) => name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")

export default defineMigration([
  addColumn("form", "slug", "text"),
  {
    up: async database => {
      const forms = await database.query`SELECT id, name FROM form`.select({
        id: t.uuid,
        name: t.text,
      })
      for (const form of forms) {
        await database.query`UPDATE form SET slug = ${toSlug(form.name)} WHERE id = ${form.id}`
      }
    },
  },
  changeColumn("form", "slug", { notNull: false }, { notNull: true }),
])
```

To decode the rows of `query`, pass the types of `kern-orm/db/types` to `select`, `get`, and `pluck`.
To name a table or a column known only at runtime in `query`, such as in a loop over tables, interpolate its name with [`identifier`](../database/sql) from `kern-orm/db`.

## List the migrations

Pass the migration modules to `defineMigrations`.
With a bundler that supports `import.meta.glob`, such as Vite, pass its result:

```ts [src/migrations.ts]
import { defineMigrations } from "kern-migrations"

export const migrations = defineMigrations(
  import.meta.glob(["./migrations/*.ts", "!./migrations/*.migration-test.ts"]),
)
```

The second pattern leaves out the files of [migration tests](./testing#check-how-a-migration-changes-data).

On Node.js and Bun, which lack `import.meta.glob`, let [`new`](./cli#create-a-migration) of the command line write the list of the modules, and pass it to `defineMigrations`:

```ts [src/migrations.ts]
import { defineMigrations } from "kern-migrations"

import list from "./migrations/index.ts"

export const migrations = defineMigrations(list)
```

Or list the modules by name:

```ts [src/migrations.ts]
import { defineMigrations } from "kern-migrations"

export const migrations = defineMigrations({
  "0001_create_form": () => import("./migrations/0001_create_form.ts"),
  "0002_create_form_field": () => import("./migrations/0002_create_form_field.ts"),
})
```

A module loads only when its migration applies or rolls back.

To ship migrations with a package, list them by name, as [Migrations in a Package](./package-migrations) shows.

When migrations use objects of other PostgreSQL schemas without naming the schema, such as functions of extensions installed in schema `extensions`, list those schemas in `searchPath`:

```ts
export const migrations = defineMigrations(
  import.meta.glob(["./migrations/*.ts", "!./migrations/*.migration-test.ts"]),
  { searchPath: ["extensions"] },
)
```

Each schema keeps its applied migrations in table `kern_migration`; to name the table otherwise, pass `tableName`.
