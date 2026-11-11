# kern-migrations

Migrations of PostgreSQL schemas for [kern-orm](https://github.com/IlyaSemenov/kern-orm) and its database layer `kern-db`: write each change of the database with helpers, SQL, or code, and apply the pending ones to a schema, such as the schema of each tenant.

## Install

Install it beside `kern-orm` or `kern-db`:

```sh
npm install kern-migrations
```

## Usage

```ts
// src/migrations/0001_create_form.ts
import { createIndex, createTable, defineMigration } from "kern-migrations"

export default defineMigration([
  createTable("form", {
    id: "uuid PRIMARY KEY DEFAULT gen_random_uuid()",
    name: "text NOT NULL",
  }),
  createIndex("form", ["name"]),
])
```

```ts
import { defineMigrations, migrate } from "kern-migrations"

const migrations = defineMigrations({
  "0001_create_form": () => import("./migrations/0001_create_form.ts"),
})

await migrate(db, migrations)
```

See [Migrations](https://ilyasemenov.github.io/kern-orm/migrations) for the helpers, steps of SQL and code, listing migrations, tenants, rolling back, the command line, and testing migrations.
