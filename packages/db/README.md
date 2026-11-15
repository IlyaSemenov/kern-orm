# kern-db

SQL queries for PostgreSQL with typed results and ambient transactions: run SQL statements, decode their rows, share transactions across function calls without passing them around, and run tests in transactions that roll back.
[kern-orm](https://github.com/IlyaSemenov/kern-orm) runs on it, and it works without the ORM.

kern-db is in early development, and the API changes between minor versions.

See [Getting Started](https://ilyasemenov.github.io/kern-orm/database/getting-started) in the documentation.

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

## Kern libraries

kern-db is part of [Kern](https://ilyasemenov.github.io/kern-orm/ecosystem), a family of PostgreSQL libraries for TypeScript, alongside [kern-migrations](https://ilyasemenov.github.io/kern-orm/migrations/getting-started) and [kern-jobs](https://ilyasemenov.github.io/kern-jobs/).
