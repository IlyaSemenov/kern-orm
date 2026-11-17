# kern-orm

Fully typed query builder for PostgreSQL: load related records in one SQL statement, run transactions without passing them around, and reuse tables across tenant schemas.

kern-orm is in early development, and the API changes between minor versions.

See the [documentation](https://ilyasemenov.github.io/kern-orm/), and how kern-orm [compares](https://ilyasemenov.github.io/kern-orm/orm/comparison) with Drizzle ORM, Kysely, Prisma ORM, and Orchid ORM.

## Install

```sh
npm install kern-orm postgres
```

See [Getting Started](https://ilyasemenov.github.io/kern-orm/orm/getting-started) for the supported runtimes, TypeScript, and PostgreSQL versions.

## Usage

Load forms with their fields in one SQL statement, and insert a form with its fields in a transaction:

```ts
import { db } from "./db"

const forms = await db.form
  .where({ published: true })
  .select("id", "name")
  .select(form => ({
    fields: form.fields.select("id", "label"),
  }))
// forms: { id: string; name: string; fields: { id: string; label: string }[] }[]

// Queries in the callback, including in called functions, join the transaction.
await db.$transaction(async () => {
  const formId = await db.form.insert({ name: "Survey", published: false }).get("id")
  await db.field.insertMany([
    { formId, label: "Name" },
    { formId, label: "Email" },
  ])
})
```

`db` comes from the definitions of your tables and their relations, bound to a database.
The definitions describe tables that already exist: create and change them with SQL or [migrations](https://ilyasemenov.github.io/kern-orm/migrations/getting-started).

```ts
// db.ts
import { bindSchema, createDatabase, defineSchema, defineTable, many } from "kern-orm"
import { postgresJsDriver } from "kern-orm/db/postgres-js"
import * as t from "kern-orm/types"
import postgres from "postgres"

const form = defineTable("form", {
  id: t.uuid.primaryKey().hasDefault(),
  name: t.text,
  published: t.boolean,
})

const field = defineTable("form_field", {
  id: t.uuid.primaryKey().hasDefault(),
  formId: t.uuid.columnName("form_id"),
  label: t.text,
})

const schema = defineSchema({ form, field }).$relations({
  form: {
    fields: many(field, { from: "id", to: "formId" }),
  },
})

const database = createDatabase({
  driver: postgresJsDriver(postgres(process.env.DATABASE_URL!)),
})

export const db = bindSchema(schema, database)
```

## Kern libraries

kern-orm is part of [Kern](https://ilyasemenov.github.io/kern-orm/ecosystem), a family of PostgreSQL libraries for TypeScript, alongside [kern-migrations](https://ilyasemenov.github.io/kern-orm/migrations/getting-started) and [kern-jobs](https://ilyasemenov.github.io/kern-jobs/); [@kern-orm/orchid-interop](https://ilyasemenov.github.io/kern-orm/orm/orchid-interop) lets you migrate an application from Orchid ORM one function at a time.
