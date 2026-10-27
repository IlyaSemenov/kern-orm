# Getting Started

kern-orm is in early development, and its API changes between minor versions.

## Install

```sh
npm install kern-orm @kern-orm/postgres-js postgres
```

kern-orm runs on Node.js 24 or newer and Bun 1.4 or newer.
It is tested on PostgreSQL 18.

## Connect

Connect to PostgreSQL with the postgres.js driver:

```ts
import { postgresJsDriver } from "@kern-orm/postgres-js"
import { createDatabase } from "kern-orm"
import postgres from "postgres"

export const database = createDatabase({
  driver: postgresJsDriver(postgres(process.env.DATABASE_URL)),
})
```

Close the database with `database.close()` when the application stops; it waits for the running transactions to end.
In a script, declare the database with `await using` to close it at the end of the scope.

## Query

Define a table, put it in a schema, bind the schema to the database, and query its tables:

```ts
import { defineSchema, defineTable } from "kern-orm"
import * as t from "kern-orm/types"

const form = defineTable("form", {
  id: t.uuid.primaryKey(),
  name: t.text,
})

const schema = defineSchema({ form })
const db = database.bind(schema)

const rows = await db.form.where({ name: "Survey" }).select("id")
// rows: { id: string }[]
```

A query started from a table of `db` executes when you await it.
To define queries once and execute them in several places, see [Reusable Queries](./queries/reusable).
