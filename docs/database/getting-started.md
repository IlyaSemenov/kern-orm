# Getting Started

::: warning
kern-db is in early development, and its API changes between minor versions.
:::

To run SQL statements with typed rows in transactions without the ORM, such as in a runner of jobs, use `kern-db`, the database layer of kern-orm.
An application of kern-orm has it already: see [Getting Started with the ORM](../orm/getting-started) instead.

## Install

::: code-group

```sh [npm]
npm install kern-db postgres
```

```sh [pnpm]
pnpm add kern-db postgres
```

```sh [bun]
bun add kern-db postgres
```

:::

If your application uses [node-postgres](./drivers#node-postgres), see Drivers.

To create and change tables with migrations, also install `kern-migrations`; see [Migrations](../migrations/getting-started).

kern-db runs on Node.js 24 or newer and Bun 1.4 or newer.
Use TypeScript 6.0 or newer, and keep `strict`, or at least `strictNullChecks`, enabled.

kern-db is tested on PostgreSQL 18.

## Connect

Connect to PostgreSQL with the postgres.js driver:

```ts [src/database.ts]
import { createDatabase } from "kern-db"
import { postgresJsDriver } from "kern-db/postgres-js"
import postgres from "postgres"

export const database = createDatabase({
  driver: postgresJsDriver(postgres(process.env.DATABASE_URL!)),
})
```

Close the database with `database.close()` when the application stops; it waits for the running transactions to end.

## Query

Run statements with `database.query`, and pass the types of `kern-db/types` to decode their rows:

```ts
import * as t from "kern-db/types"

import { database } from "./database"

const forms = await database.query`SELECT id, name FROM form WHERE published = ${true}`.select({
  id: t.uuid,
  name: t.text,
})
// forms: { id: string; name: string }[]
```

To run statements in a transaction, pass a callback to `database.transaction`: every statement in the callback joins the transaction, including statements in called functions.

```ts
await database.transaction(async () => {
  const id =
    await database.query`INSERT INTO form (name, published) VALUES (${"Survey"}, false) RETURNING id`.get(
      t.uuid,
    )
  await database.query`UPDATE form SET published = true WHERE id = ${id}`
})
```

## Next steps

- [Drivers](./drivers): the drivers of postgres.js and node-postgres.
- [SQL Queries and Scripts](./sql): scripts, names known at runtime, and JSON and arrays in statements.
- [Types](./types): the values of the built-in types, nullable and narrowed values, and types of your own.
- [Transactions](./transactions): nested transactions, advisory locks, isolation levels, and statements outside a transaction.
- [Testing](./testing): run each test in a transaction that rolls back.
- [Errors](./errors): statements that PostgreSQL rejects and lost connections.
