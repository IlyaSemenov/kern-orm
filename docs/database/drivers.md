# Drivers

kern-db runs statements through a driver for the PostgreSQL client of your application.
Install your client, and pass the driver for it to `createDatabase`:

- [postgres.js](#postgres-js): `kern-db/postgres-js`.
- [node-postgres](#node-postgres): `kern-db/node-postgres`.

In an application of kern-orm, install the client with `kern-orm` instead of `kern-db`, and import the drivers from `kern-orm/db/postgres-js` and `kern-orm/db/node-postgres`.

For another client, [write a driver](./custom-drivers).

## postgres.js

If your application uses [postgres.js](https://github.com/porsager/postgres), install it with kern-db:

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

Pass your client to `postgresJsDriver`:

```ts
import { createDatabase } from "kern-db"
import { postgresJsDriver } from "kern-db/postgres-js"
import postgres from "postgres"

export const database = createDatabase({
  driver: postgresJsDriver(postgres(process.env.DATABASE_URL!)),
})
```

`database.close()` ends the client, so do not call `sql.end()` yourself.

kern-db reads results as PostgreSQL returns them, so create the client without transforms of the column names or rows of results, such as `postgres.camel`, and give other code that relies on such a transform a client of its own.
In an application of kern-orm, name the columns of your tables in snake case with its [naming conventions](../orm/schemas#naming-conventions) instead.

## node-postgres

If your application uses [node-postgres](https://node-postgres.com/), install it with kern-db, and `@types/pg` for its types:

::: code-group

```sh [npm]
npm install kern-db pg
npm install --save-dev @types/pg
```

```sh [pnpm]
pnpm add kern-db pg
pnpm add --save-dev @types/pg
```

```sh [bun]
bun add kern-db pg
bun add --dev @types/pg
```

:::

Pass your pool to `nodePostgresDriver`:

```ts
import { createDatabase } from "kern-db"
import { nodePostgresDriver } from "kern-db/node-postgres"
import { Pool } from "pg"

export const database = createDatabase({
  driver: nodePostgresDriver(new Pool({ connectionString: process.env.DATABASE_URL })),
})
```

`database.close()` ends the pool, so do not call `pool.end()` yourself.
