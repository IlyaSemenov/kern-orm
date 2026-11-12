# Migrations in a Package

Ship migrations with your package so that applications can create and update the tables it needs.
For example, a form builder package can ship migrations for its tables `form` and `form_field`.

## Define the migrations

Put each migration in its own module, as in an application:

```ts [src/migrations/0001_create_form.ts]
import { createTable, defineMigration } from "kern-migrations"

export default defineMigration([
  createTable("form", {
    id: "uuid PRIMARY KEY DEFAULT gen_random_uuid()",
    name: "text NOT NULL",
  }),
  createTable("form_field", {
    id: "uuid PRIMARY KEY DEFAULT gen_random_uuid()",
    form_id: "uuid NOT NULL REFERENCES form",
    label: "text NOT NULL",
  }),
])
```

List the modules by name in `defineMigrations`, and give the package its own table of applied migrations:

```ts [src/migrations.ts]
import { defineMigrations } from "kern-migrations"

export const formMigrations = defineMigrations(
  {
    "0001_create_form": () => import("./migrations/0001_create_form.ts"),
    "0002_add_form_field_position": () => import("./migrations/0002_add_form_field_position.ts"),
  },
  { tableName: "form_builder_migration" },
)
```

A bundler of packages, such as tsdown, puts each module into a chunk of its own, which loads only when its migration applies or rolls back.

The package and the application record their applied migrations in separate tables of each schema, so number the migrations of the package from `0001`, independently of the application.

Keep released migrations unchanged, so that existing and new installations build the same tables, and add a migration for each further change.

Test the migrations with [`verifyMigrations`](./testing).

## Apply the migrations

Apply the migrations of the package with `migrate`, such as when the application starts:

```ts
import { formMigrations } from "@acme/form-builder"
import { migrate } from "kern-migrations"

await migrate(db, formMigrations)
await migrate(db, migrations)
```

The tables of the package are created in the schema of the `Db`, beside the tables of the application.
To keep them in a schema of their own, pass it as `schemaName`:

```ts
await migrate(db, formMigrations, { schemaName: "form_builder" })
```

When your package takes the driver of the application rather than its database, pass the driver to `migrate`, which runs on a database of its own over the driver and leaves the driver open:

```ts [src/migrate.ts]
import type { Driver } from "kern-db"
import { migrate } from "kern-migrations"

import { formMigrations } from "./migrations"

export async function migrateFormBuilder(driver: Driver) {
  await migrate(driver, formMigrations, { schemaName: "form_builder" })
}
```

To check the driver or database that the application passes before your package does anything else with it, call `isMigrationTarget`.
`migrate` checks `schemaName` itself before any query, so pass an option of your package as `schemaName` without checking it.

With a [PostgreSQL schema per tenant](./applying#tenants), apply the migrations of the package to the schema of each tenant, beside the migrations of the tenant.
