# kern-orm

Fully typed relational query builder for PostgreSQL with ambient transactions and single-query relation loading.

kern-orm is in early development, and the API changes between minor versions.

See the [documentation](https://ilyasemenov.github.io/kern-orm/).

## Install

```sh
npm install kern-orm postgres
```

See [Getting Started](https://ilyasemenov.github.io/kern-orm/getting-started) for the supported runtimes, TypeScript, and PostgreSQL versions.

## Usage

Describe the tables and their relations, then load forms with their fields in one SQL statement, and insert a form with its fields in a transaction:

```ts
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
const db = bindSchema(schema, database)

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
