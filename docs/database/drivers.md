# Drivers

<!--@include: ./_without-orm.md-->

kern-orm runs queries through a driver for the PostgreSQL client of your application.
Install your client, and pass the driver for it to `createDatabase`:

- [postgres.js](#postgres-js): `kern-orm/db/postgres-js`.
- [node-postgres](#node-postgres): `kern-orm/db/node-postgres`.

For another client, [write a driver](./custom-drivers).

## postgres.js

If your application uses [postgres.js](https://github.com/porsager/postgres), install it with kern-orm:

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

Pass your client to `postgresJsDriver`:

```ts
import { createDatabase } from "kern-orm/db"
import { postgresJsDriver } from "kern-orm/db/postgres-js"
import postgres from "postgres"

export const database = createDatabase({
  driver: postgresJsDriver(postgres(process.env.DATABASE_URL!)),
})
```

`database.close()` ends the client, so do not call `sql.end()` yourself.

kern-orm reads results as PostgreSQL returns them, so create the client without transforms of the column names or rows of results, such as `postgres.camel`.
To name the columns of your tables in snake case, use the [naming conventions](../orm/schemas#naming-conventions) of kern-orm instead, and give other code that relies on such a transform a client of its own.

## node-postgres

If your application uses [node-postgres](https://node-postgres.com/), install it with kern-orm, and `@types/pg` for its types:

::: code-group

```sh [npm]
npm install kern-orm pg
npm install --save-dev @types/pg
```

```sh [pnpm]
pnpm add kern-orm pg
pnpm add --save-dev @types/pg
```

```sh [bun]
bun add kern-orm pg
bun add --dev @types/pg
```

:::

Pass your pool to `nodePostgresDriver`:

```ts
import { createDatabase } from "kern-orm/db"
import { nodePostgresDriver } from "kern-orm/db/node-postgres"
import { Pool } from "pg"

export const database = createDatabase({
  driver: nodePostgresDriver(new Pool({ connectionString: process.env.DATABASE_URL })),
})
```

`database.close()` ends the pool, so do not call `pool.end()` yourself.
