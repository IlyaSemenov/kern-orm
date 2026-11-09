# Drivers

kern-orm runs queries through a driver for the PostgreSQL client of your application.
Install the driver for your client, and pass it to `createDatabase`:

- [postgres.js](#postgres-js): `@kern-orm/postgres-js`.
- [node-postgres](#node-postgres): `@kern-orm/node-postgres`.

For another client, [write a driver](./custom-drivers).

## postgres.js

If your application uses [postgres.js](https://github.com/porsager/postgres), install `@kern-orm/postgres-js`:

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

Pass your client to `postgresJsDriver`:

```ts
import { postgresJsDriver } from "@kern-orm/postgres-js"
import { createDatabase } from "kern-orm"
import postgres from "postgres"

export const database = createDatabase({
  driver: postgresJsDriver(postgres(process.env.DATABASE_URL!)),
})
```

`database.close()` ends the client, so do not call `sql.end()` yourself.

kern-orm reads results as PostgreSQL returns them, so create the client without transforms of the column names or rows of results, such as `postgres.camel`.
To name the columns of your tables in snake case, use the [naming conventions](./schemas#naming-conventions) of kern-orm instead, and give other code that relies on such a transform a client of its own.

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
