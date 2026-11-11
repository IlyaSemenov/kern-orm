# kern-orm

[![npm](https://img.shields.io/npm/v/kern-orm)](https://www.npmjs.com/package/kern-orm)
[![Test](https://github.com/IlyaSemenov/kern-orm/actions/workflows/test.yml/badge.svg)](https://github.com/IlyaSemenov/kern-orm/actions/workflows/test.yml)
[![License](https://img.shields.io/npm/l/kern-orm)](LICENSE)

Fully typed relational query builder for PostgreSQL with ambient transactions and single-query relation loading.

kern-orm is in early development, and the API changes between minor versions.

- **Fully typed**: query results and filters are inferred from table definitions.
- **Related records in one query**: select the related records of each row, at any depth, in a single SQL statement.
- **Schema per tenant**: reuse table definitions and queries across PostgreSQL schemas, such as tenant schemas and a shared application schema.
- **Ambient transactions**: queries join the current transaction without passing it around.
- **Tests in transactions**: run each test in a transaction that rolls back, with `node:test`, `bun:test`, or Vitest.
- **SQL when you need it**: add SQL conditions to queries, or run any SQL statement and get typed rows.
- **Migrations**: apply SQL migrations to any PostgreSQL schema, such as the schema of each tenant.

See the [documentation](https://ilyasemenov.github.io/kern-orm/).

## Install

```sh
npm install kern-orm @kern-orm/postgres-js postgres
```

See [Getting Started](https://ilyasemenov.github.io/kern-orm/getting-started) for the supported runtimes, TypeScript, and PostgreSQL versions.

## Usage

Describe the tables and their relations, then load forms with their fields in one SQL statement, and insert a form with its fields in a transaction:

```ts
import { postgresJsDriver } from "@kern-orm/postgres-js"
import { bindSchema, createDatabase, defineSchema, defineTable, many } from "kern-orm"
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

## Packages

- [`kern-orm`](packages/kern-orm): tables, schemas, queries, SQL compiler, and transactions.
- [`@kern-orm/postgres-js`](packages/postgres-js): [postgres.js](https://github.com/porsager/postgres) driver.
- [`@kern-orm/node-postgres`](packages/node-postgres): [node-postgres](https://node-postgres.com/) driver.
- [`@kern-orm/migrations`](packages/migrations): migrations of PostgreSQL schemas.

## Development

```sh
bun install
bun run test
bun run test:node
bun run types
bun run build
bun run docs:dev
```

Set `DATABASE_URL` to an empty database to run tests against PostgreSQL, such as in `.env.test.local` copied from [`.env.test.local.example`](.env.test.local.example); without it, those tests are skipped.
The tests leave the database unchanged.
