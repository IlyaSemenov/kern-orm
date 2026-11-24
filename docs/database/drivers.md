# Drivers

kern-db runs statements through a driver for the PostgreSQL client of your application.
Pass the driver for your client to `createDatabase`:

- [postgres.js](#postgres-js): `kern-db/postgres-js`.
- [node-postgres](#node-postgres): `kern-db/node-postgres`.
- [Bun SQL](#bun-sql): `kern-db/bun-sql`.

In an application of kern-orm, install `kern-orm` in place of `kern-db` and import the drivers from `kern-orm/db/postgres-js`, `kern-orm/db/node-postgres`, or `kern-orm/db/bun-sql`.

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
In an application of kern-orm, name the columns of your tables in snake case with its [naming conventions](../orm/tables#naming-conventions) instead.

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

## Bun SQL

If your application uses the built-in [Bun SQL](https://bun.com/docs/runtime/sql) client on Bun 1.4.4 or newer, install `kern-db` and add `@types/bun` for TypeScript:

```sh
bun add kern-db
bun add --dev @types/bun
```

```ts
import { SQL } from "bun"
import { createDatabase } from "kern-db"
import { bunSqlDriver } from "kern-db/bun-sql"

export const database = createDatabase({
  driver: bunSqlDriver(new SQL(process.env.DATABASE_URL!, { prepare: false })),
})
```

Set `prepare: false` so PostgreSQL sends every result in the text format that kern-db decodes.
This setting applies to the entire client, so give code that needs named prepared statements a separate client.
Close the client through `database.close()` so pending queries and transactions can finish.

kern-db looks up result columns by the names in your SQL.
Create the client without a transform that renames result columns, such as `transform: SQL.camel`, which turns `user_id` into `userId`.

### Scripts and transactions

For a single script, put the statements in one `database.script` call and leave out `BEGIN` and `COMMIT`.
PostgreSQL commits both changes together or rolls both back.

```ts
await database.script`
  ALTER TABLE form ADD COLUMN published_at timestamptz;
  CREATE INDEX form_published_at_idx ON form (published_at);
`
```

To group separate calls in one transaction, put them inside the same `database.transaction` callback.

```ts
await database.transaction(async () => {
  await database.query`ALTER TABLE form ADD COLUMN published_at timestamptz`
  await database.query`CREATE INDEX form_published_at_idx ON form (published_at)`
})
```

If you write `BEGIN; …; COMMIT` inside a script sent directly to the pool, the Bun SQL driver sends an extra `SAVEPOINT kern_pool_probe` to check that the transaction ended.
PostgreSQL can log error `25P01` for this check even when the script committed successfully.
