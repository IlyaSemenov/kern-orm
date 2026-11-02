# Migrations

Write each change of your database, such as a new table or column, as a migration: SQL that makes the change, and SQL that undoes it.
Call `migrate`, such as when your application starts, to bring the database up to date: it applies the new migrations and remembers which ones it has applied.

Install `@kern-orm/migrations`:

::: code-group

```sh [npm]
npm install @kern-orm/migrations
```

```sh [pnpm]
pnpm add @kern-orm/migrations
```

```sh [bun]
bun add @kern-orm/migrations
```

:::

## Write a migration

Put each migration in its own module and export it with `defineMigration`: `up` applies the change, and `down` undoes it.

```ts [src/migrations/0001_create_form.ts]
import { defineMigration } from "@kern-orm/migrations"

export default defineMigration({
  up: `
    CREATE TABLE form (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      published boolean NOT NULL
    )
  `,
  down: "DROP TABLE form",
})
```

Name each module `<number>_<name>`, such as `0001_create_form.ts`, with a number of its own: the numbers order the migrations.

Write names without a PostgreSQL schema, such as `form` rather than `app.form`: migrations run with the search path of the schema they apply to, so the same migrations apply to any schema.

Do not import the tables, custom types, or database of your application into a migration: a migration must do the same on every database and in every later version of the application.

### Several steps

To make several changes in one migration, export an array of steps: they apply in order and roll back in reverse order.

```ts
export default defineMigration([
  {
    up: `
      CREATE TABLE form_field (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        form_id uuid NOT NULL REFERENCES form,
        label text NOT NULL
      )
    `,
    down: "DROP TABLE form_field",
  },
  {
    up: "CREATE INDEX form_field_form_id ON form_field (form_id)",
    down: "DROP INDEX form_field_form_id",
  },
])
```

Leave out `down` of a step that cannot be undone, such as a change of data: rolling back skips it.

### Code in a migration

When a step needs code, such as to compute values from existing rows, pass a function instead of SQL.
It receives the database of the migration, whose `query` and `script` run in the transaction of the migration:

```ts
import { defineMigration } from "@kern-orm/migrations"
import * as t from "kern-orm/types"

const toSlug = (name: string) => name.toLowerCase().replaceAll(/\W+/g, "-")

export default defineMigration({
  up: async database => {
    await database.script("ALTER TABLE form ADD COLUMN slug text")
    const forms = await database.query`SELECT id, name FROM form`.select({
      id: t.uuid,
      name: t.text,
    })
    for (const form of forms) {
      await database.query`UPDATE form SET slug = ${toSlug(form.name)} WHERE id = ${form.id}`
    }
  },
  down: "ALTER TABLE form DROP COLUMN slug",
})
```

## List the migrations

Pass the migration modules to `defineMigrations`.
With a bundler that supports `import.meta.glob`, such as Vite, pass its result:

```ts [src/migrations.ts]
import { defineMigrations } from "@kern-orm/migrations"

export const migrations = defineMigrations(import.meta.glob("./migrations/*.ts"))
```

On Node.js and Bun, which lack `import.meta.glob`, list the modules by name:

```ts [src/migrations.ts]
import { defineMigrations } from "@kern-orm/migrations"

export const migrations = defineMigrations({
  "0001_create_form": () => import("./migrations/0001_create_form.ts"),
  "0002_create_form_field": () => import("./migrations/0002_create_form_field.ts"),
})
```

A module loads only when its migration applies or rolls back.

When migrations use objects of other PostgreSQL schemas without naming the schema, such as functions of extensions installed in schema `extensions`, list those schemas in `searchPath`:

```ts
export const migrations = defineMigrations(import.meta.glob("./migrations/*.ts"), {
  searchPath: ["extensions"],
})
```

Each schema keeps its applied migrations in table `kern_migration`; to name the table otherwise, pass `tableName`.

## Apply migrations

Call `migrate` with your `Db` and the migrations, such as when the application starts or in a deploy script:

```ts
import { migrate } from "@kern-orm/migrations"

await migrate(db, migrations)
```

It applies the pending migrations to the PostgreSQL schema of the `Db` in one transaction, and resolves to their names.
It creates the schema and its table of migrations when they are missing.
Instances of the application that migrate one schema at once, such as when they start together, apply each migration once.

When a migration fails, `migrate` rolls back all the migrations of the call and rejects with a `MigrationError`, which names the migration and its step and keeps the original error in `cause`.

Instances of an older version of the application keep migrating during a rolling deploy: `migrate` accepts migrations that a newer version has applied after its own last migration.
Give a migration that you merge from another branch a number after the migrations already applied anywhere: `migrate` rejects a pending migration before an applied one.

To apply migrations without a `Db`, such as when your application queries the database with another library, pass the `Database`:

```ts
await migrate(database, migrations)
```

The migrations apply to `current_schema()`, the first existing schema of the search path, such as `public`.
To apply them to another schema, pass it as `schemaName`:

```ts
await migrate(database, migrations, { schemaName: "app" })
```

## Tenants

With a [PostgreSQL schema per tenant](./multiple-schemas), migrate the `Db` of the tenants: `migrate` applies the migrations to the schema of the current tenant.

```ts
await migrate(tenantDb, tenantMigrations)
```

Migrating a tenant whose schema is up to date costs two light statements, so you can migrate each tenant at its first request in each process.

To create a tenant, pass its schema as `schemaName` in the transaction that creates it, so that its migrations commit or roll back with it:

```ts
await saasDb.$transaction(async () => {
  await saasDb.tenant.insert({ id: tenantId, subdomain: "acme" })
  await migrate(tenantDb, tenantMigrations, { schemaName: "tenant_acme" })
})
```

## Roll back

To undo the last applied migration, call `rollback`:

```ts
import { rollback } from "@kern-orm/migrations"

await rollback(db, migrations)
```

Pass `count` to undo several of the last migrations, or `"all"` to undo every migration.

To undo the last applied migration and apply it again in one transaction, such as after you change it while you write it, call `redo`; it also takes `count`:

```ts
import { redo } from "@kern-orm/migrations"

await redo(db, migrations)
```

Both reject when the schema has a migration that `migrations` lack, since they cannot undo it.

## Status

To see which migrations a schema has applied, call `getMigrationStatus`:

```ts
import { getMigrationStatus } from "@kern-orm/migrations"

const { applied, pending, unknown } = await getMigrationStatus(db, migrations)
```

`unknown` lists the applied migrations that `migrations` lack, such as those of a newer version of the application.
