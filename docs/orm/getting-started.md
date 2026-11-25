# Getting Started

::: warning
kern-orm is in early development, and its API changes between minor versions.
:::

## Install

::: code-group

```sh [npm]
npm install kern-orm postgres
```

```sh [pnpm]
pnpm add kern-orm postgres
```

```sh [bun]
bun add kern-orm postgres
```

:::

If your application uses [node-postgres](../database/drivers#node-postgres) or [Bun SQL](../database/drivers#bun-sql), see Drivers.

To create and change tables with migrations, also install `kern-migrations`; see [Migrations](../migrations/getting-started).

kern-orm runs on Node.js 24 or newer and Bun 1.4 or newer.
Use TypeScript 6.0 or newer, and keep `strict`, or at least `strictNullChecks`, enabled.

kern-orm is tested on PostgreSQL 18.

## Define tables

kern-orm queries the tables that already exist in your database and does not create or alter them: create them with SQL, directly or in [migrations](../migrations/getting-started):

```sql
CREATE TABLE form (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  published boolean NOT NULL
);
```

Describe each table with `defineTable` and put the tables in a schema:

```ts [src/schema.ts]
import { defineSchema, defineTable } from "kern-orm"
import * as t from "kern-orm/types"

const form = defineTable("form", {
  id: t.uuid.primaryKey().hasDefault(),
  name: t.text,
  published: t.boolean,
})

export const schema = defineSchema({ form })
```

`hasDefault()` lets inserts omit the `id` that the database generates.

## Connect

Connect to PostgreSQL with the postgres.js driver and bind the schema to the database:

```ts [src/db.ts]
import { bindSchema, createDatabase } from "kern-orm"
import { postgresJsDriver } from "kern-orm/db/postgres-js"
import postgres from "postgres"

import { schema } from "./schema"

export const database = createDatabase({
  driver: postgresJsDriver(postgres(process.env.DATABASE_URL!)),
})

export const db = bindSchema(schema, database)
```

Close the database with `database.close()` when the application stops; it waits for the running transactions on its connections to end.

## Query

Import `db` wherever you query the database and start queries from its tables:

```ts
import { db } from "./db"

await db.form.insert({ name: "Survey", published: true })

const forms = await db.form.where({ published: true }).select("id", "name")
// forms: { id: string; name: string }[]
```

## Other ways to connect

In a script, declare the database with `await using` to close it at the end of the scope:

```ts
await using database = createDatabase({
  driver: postgresJsDriver(postgres(process.env.DATABASE_URL!)),
})
const db = bindSchema(schema, database)
```

When your application gets its database from dependency injection, pass a function that returns it, and each query of `db` runs on the database of its context:

```ts [src/db.ts]
// useDatabase() returns the database of the current context
export const db = bindSchema(schema, () => useDatabase())
```

See [Database of the current context](./schemas#database-of-the-current-context).

## Next steps

- [Tables](./tables): define tables, declare their keys, and map column names.
- [Views](./views): define views.
- [Schemas and Relations](./schemas): bind a schema to a database, relate tables, and choose a PostgreSQL schema.
- [Multiple Schemas](./multiple-schemas): reuse tables across tenant schemas and a shared schema.
- [Types](./types): column types and nullable columns.
- [Custom Types](./custom-types): use a PostgreSQL type such as `ltree` in queries, and add operators to its expressions.
- [Queries](./queries/): select, filter, and sort records, load their related records, and insert, update, and delete them.
- [Related Records](./queries/relations): load the related records of each row in the same query.
- [Transactions](./transactions): run queries in a transaction without passing it around.
- [Testing](./testing): run each test in a transaction that rolls back.
- [Errors](./errors): statements that PostgreSQL rejects, lost connections, missing rows, and results that fail to decode.
