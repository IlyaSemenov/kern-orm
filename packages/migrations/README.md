# @kern-orm/migrations

Migrations of PostgreSQL schemas for [kern-orm](https://github.com/IlyaSemenov/kern-orm): write each change of the database as SQL or code, and apply the pending ones to a schema, such as the schema of each tenant.

## Install

```sh
npm install kern-orm @kern-orm/migrations
```

## Usage

```ts
// src/migrations/0001_create_form.ts
import { defineMigration } from "@kern-orm/migrations"

export default defineMigration({
  up: "CREATE TABLE form (id uuid PRIMARY KEY, name text NOT NULL)",
  down: "DROP TABLE form",
})
```

```ts
import { defineMigrations, migrate } from "@kern-orm/migrations"

const migrations = defineMigrations({
  "0001_create_form": () => import("./migrations/0001_create_form.ts"),
})

await migrate(db, migrations)
```

See [Migrations](https://ilyasemenov.github.io/kern-orm/migrations) for helpers, listing migrations, tenants, rolling back, and the command line.
