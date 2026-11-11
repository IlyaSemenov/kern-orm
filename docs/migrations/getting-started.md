# Getting Started

::: warning
kern-migrations is in early development, and its API changes between minor versions.
:::

To create and change the tables of your database, write migrations and apply them with `kern-migrations`, with kern-orm or with [kern-db](../database/getting-started) alone.

## Install

Install `kern-migrations` beside `kern-orm` or `kern-db`:

::: code-group

```sh [npm]
npm install kern-migrations
```

```sh [pnpm]
pnpm add kern-migrations
```

```sh [bun]
bun add kern-migrations
```

:::

kern-migrations runs on Node.js 24 or newer and Bun 1.4 or newer.
Use TypeScript 6.0 or newer, and keep `strict`, or at least `strictNullChecks`, enabled.

kern-migrations is tested on PostgreSQL 18.

## Write a migration

Put each migration in its own module, named `<number>_<name>`, and export its steps with `defineMigration`:

```ts [src/migrations/0001_create_form.ts]
import { createTable, defineMigration } from "kern-migrations"

export default defineMigration(
  createTable("form", {
    id: "uuid PRIMARY KEY DEFAULT gen_random_uuid()",
    name: "text NOT NULL",
    published: "boolean NOT NULL",
  }),
)
```

## List the migrations

Pass the migration modules to `defineMigrations`:

```ts [src/migrations.ts]
import { defineMigrations } from "kern-migrations"

export const migrations = defineMigrations({
  "0001_create_form": () => import("./migrations/0001_create_form.ts"),
})
```

## Apply the migrations

Call `migrate` with your `Db` and the migrations, such as when the application starts:

```ts
import { migrate } from "kern-migrations"

import { db } from "./db"
import { migrations } from "./migrations"

await migrate(db, migrations)
```

Without the ORM, pass your database instead: `await migrate(database, migrations)`.

## Next steps

- [Migrations](./): helpers, steps of SQL and code, listing migrations, tenants, rolling back, the command line, and testing migrations.
- [Custom Migration Helpers](./custom-helpers): steps of your own that migrations reuse.
- [Migrations in a Package](./package-migrations): migrations that a package ships to the applications that use it.
