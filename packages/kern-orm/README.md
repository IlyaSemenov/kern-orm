# kern-orm

Fully typed relational query builder for PostgreSQL.

See the [documentation](https://ilyasemenov.github.io/kern-orm/).

## Install

```sh
npm install kern-orm @kern-orm/postgres-js postgres
```

## Usage

```ts
import { postgresJsDriver } from "@kern-orm/postgres-js"
import { createDatabase, defineSchema, defineTable } from "kern-orm"
import * as t from "kern-orm/types"
import postgres from "postgres"

const form = defineTable("form", {
  id: t.uuid.primaryKey(),
  name: t.text,
  published: t.boolean,
})

const database = createDatabase({ driver: postgresJsDriver(postgres(process.env.DATABASE_URL)) })
const schema = defineSchema({ form })
const db = database.bind(schema)

await db.$transaction(async () => {
  // Joins the transaction without passing it explicitly.
  const forms = await db.form.where({ published: true }).select("id", "name")
})
```
