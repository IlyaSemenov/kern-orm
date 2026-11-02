# Getting Started

::: warning
kern-orm is in early development, and its API changes between minor versions.
:::

## Install

::: code-group

```sh [npm]
npm install kern-orm @kern-orm/postgres-js postgres
```

```sh [pnpm]
pnpm add kern-orm @kern-orm/postgres-js postgres
```

```sh [bun]
bun add kern-orm @kern-orm/postgres-js postgres
```

:::

If your application uses postgres.js 3, see [Drivers](./drivers#postgres-js-3).

kern-orm runs on Node.js 24 or newer and Bun 1.4 or newer.
Use TypeScript 6.0 or newer, and keep `strict`, or at least `strictNullChecks`, enabled.

kern-orm is tested on PostgreSQL 18.

## Define tables

kern-orm queries the tables that already exist in your database and does not create or alter them: create them with SQL or your migration tool, such as:

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
import { postgresJsDriver } from "@kern-orm/postgres-js"
import { createDatabase } from "kern-orm"
import postgres from "postgres"

import { schema } from "./schema"

export const database = createDatabase({
  driver: postgresJsDriver(postgres(process.env.DATABASE_URL!)),
})

export const db = database.bind(schema)
```

Close the database with `database.close()` when the application stops; it waits for the running transactions to end.

In a script, declare the database with `await using` to close it at the end of the scope:

```ts
await using database = createDatabase({
  driver: postgresJsDriver(postgres(process.env.DATABASE_URL!)),
})
const db = database.bind(schema)
```

## Query

Import `db` wherever you query the database and start queries from its tables:

```ts
import { db } from "./db"

const forms = await db.form.where({ published: true }).select("id", "name")
// forms: { id: string; name: string }[]
```

## Next steps

- [Tables and Schemas](./schemas): keys of tables, schemas, and relations between tables.
- [Types](./types): column types, nullable columns, and your own types.
- [Queries](./queries/): select, filter, and sort records, load their related records, and insert, update, and delete them.
- [Transactions](./transactions): run queries in a transaction without passing it around.
- [Testing](./testing): run each test in a transaction that rolls back.
- [Multiple Schemas](./multiple-schemas): reuse tables across tenant schemas and a shared schema.
