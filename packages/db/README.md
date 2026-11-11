# kern-db

PostgreSQL database layer with ambient transactions, typed SQL queries, and test transactions.
It is the database layer of [kern-orm](https://github.com/IlyaSemenov/kern-orm), and it works without the ORM.

kern-db is in early development, and the API changes between minor versions.

See the [documentation](https://ilyasemenov.github.io/kern-orm/).

## Install

```sh
npm install kern-db postgres
```

## Usage

```ts
import { createDatabase } from "kern-db"
import { postgresJsDriver } from "kern-db/postgres-js"
import * as t from "kern-db/types"
import postgres from "postgres"

const database = createDatabase({
  driver: postgresJsDriver(postgres(process.env.DATABASE_URL!)),
})

// Queries in the callback, including in called functions, join the transaction.
await database.transaction(async () => {
  const id = await database.query`INSERT INTO form (name) VALUES (${"Survey"}) RETURNING id`.get(
    t.uuid,
  )
  await database.query`UPDATE form SET published = true WHERE id = ${id}`
})
```
