# Drivers

kern-orm runs queries through a driver for the PostgreSQL client of your application.
Install the driver for your client, and pass it to `createDatabase`:

- postgres.js 4: `@kern-orm/postgres-js`, as in [Getting Started](./getting-started#connect).
- postgres.js 3: `@kern-orm/postgres-js-v3`, described below.
- node-postgres: `@kern-orm/node-postgres`, described below.

For another client, [write a driver](./custom-drivers).

## postgres.js 3

If your application uses postgres.js 3, install `@kern-orm/postgres-js-v3` instead of `@kern-orm/postgres-js`:

::: code-group

```sh [npm]
npm install kern-orm @kern-orm/postgres-js-v3 postgres@3
```

```sh [pnpm]
pnpm add kern-orm @kern-orm/postgres-js-v3 postgres@3
```

```sh [bun]
bun add kern-orm @kern-orm/postgres-js-v3 postgres@3
```

:::

Import `postgresJsDriver` from it:

```ts
import { postgresJsDriver } from "@kern-orm/postgres-js-v3"
import { createDatabase } from "kern-orm"
import postgres from "postgres"

export const database = createDatabase({
  driver: postgresJsDriver(postgres(process.env.DATABASE_URL!)),
})
```

Upgrade to postgres.js 4 when you can: when a connection of postgres.js 3 breaks inside a transaction, Node.js terminates the process, and Bun leaves the client unable to run further queries.

Keep `fetch_types` of the postgres.js 3 client enabled: without it, the first transaction can wait until the database closes.

## node-postgres

If your application uses [node-postgres](https://node-postgres.com/), install `@kern-orm/node-postgres` instead of `@kern-orm/postgres-js`, and `@types/pg` for its types:

::: code-group

```sh [npm]
npm install kern-orm @kern-orm/node-postgres pg
npm install --save-dev @types/pg
```

```sh [pnpm]
pnpm add kern-orm @kern-orm/node-postgres pg
pnpm add --save-dev @types/pg
```

```sh [bun]
bun add kern-orm @kern-orm/node-postgres pg
bun add --dev @types/pg
```

:::

Pass your pool to `nodePostgresDriver`:

```ts
import { nodePostgresDriver } from "@kern-orm/node-postgres"
import { createDatabase } from "kern-orm"
import { Pool } from "pg"

export const database = createDatabase({
  driver: nodePostgresDriver(new Pool({ connectionString: process.env.DATABASE_URL })),
})
```

`database.close()` ends the pool, so do not call `pool.end()` yourself.
