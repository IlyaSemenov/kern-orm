# @kern-orm/orchid-interop

Run existing Orchid ORM queries and new [kern-orm](https://github.com/IlyaSemenov/kern-orm) queries on one connection pool and in the same transactions, to move an application from Orchid ORM to kern-orm one function at a time.

The adapter is experimental: it supports Orchid ORM 1.x (1.78.61 or later) and postgres.js 4, and not every feature of Orchid ORM.

## Install

```sh
npm install @kern-orm/orchid-interop kern-orm orchid-orm postgres@4
```

## Usage

```ts
import { bindSchema } from "kern-orm"
import { createOrchidInterop } from "@kern-orm/orchid-interop"

import { UserTable } from "./legacy/user.table"
import { schema } from "./schema"

export const { database, orchid } = await createOrchidInterop(
  { connection: { databaseURL: process.env.DATABASE_URL! } },
  { user: UserTable },
)
export const db = bindSchema(schema, database)

await db.$transaction(async () => {
  const user = await orchid.user.create({ email })
  await db.profile.insert({ userId: user.id, name })
})
```

See [the documentation](https://ilyasemenov.github.io/kern-orm/orm/orchid-interop) for transactions, tests, and limitations.
