# kern-migrations

PostgreSQL migrations in SQL and TypeScript: write schema changes with helpers, SQL, or TypeScript functions, apply and roll them back, ship them in a package, and test them against PostgreSQL.
It applies migrations through [kern-orm](https://github.com/IlyaSemenov/kern-orm) or its database layer `kern-db`.

kern-migrations is in early development, and the API changes between minor versions.

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

See [the documentation](https://ilyasemenov.github.io/kern-orm/migrations/getting-started) for the helpers, steps of SQL and code, listing migrations, tenants, rolling back, the command line, and testing migrations.

## Kern libraries

kern-migrations is part of [Kern](https://ilyasemenov.github.io/kern-orm/ecosystem), a family of PostgreSQL libraries for TypeScript, alongside [kern-orm](https://ilyasemenov.github.io/kern-orm/), [kern-db](https://ilyasemenov.github.io/kern-orm/database/getting-started), and [kern-jobs](https://ilyasemenov.github.io/kern-jobs/).
