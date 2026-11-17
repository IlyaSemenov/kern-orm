# kern-orm

[![npm](https://img.shields.io/npm/v/kern-orm)](https://www.npmjs.com/package/kern-orm)
[![Test](https://github.com/IlyaSemenov/kern-orm/actions/workflows/test.yml/badge.svg)](https://github.com/IlyaSemenov/kern-orm/actions/workflows/test.yml)
[![License](https://img.shields.io/npm/l/kern-orm)](LICENSE)

Fully typed query builder for PostgreSQL: load related records in one SQL statement, run transactions without passing them around, and reuse tables across tenant schemas.

kern-orm is in early development, and the API changes between minor versions.

- **Related records in one query**: select the related records of each row, at any depth, in a single SQL statement, with the shape of the result inferred.
- **Transactions across function calls**: queries join the current transaction without passing a transaction object through your code.
- **Schema per tenant**: reuse table definitions and queries across PostgreSQL schemas, such as tenant schemas and a shared application schema.
- **Tests that roll back**: run each test in a transaction that rolls back, with `node:test`, `bun:test`, or Vitest.
- **SQL when you need it**: add SQL conditions to queries, or run any SQL statement and get typed rows.
- **Migrations**: write migrations with schema helpers, SQL, or TypeScript functions, ship them in a package, and test them.

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

kern-orm is part of [Kern](https://ilyasemenov.github.io/kern-orm/ecosystem), a family of PostgreSQL libraries for TypeScript:

- [`kern-orm`](packages/orm): typed relational queries, including related records.
- [`kern-db`](packages/db): SQL statements with typed rows, ambient transactions, and test transactions, without the ORM; kern-orm runs on it.
- [`kern-migrations`](packages/migrations): migrations of PostgreSQL schemas in SQL and TypeScript, applied through kern-orm or kern-db.
- [`@kern-orm/orchid-interop`](packages/orchid-interop): Orchid ORM and kern-orm queries on one pool and in the same transactions, to move an application from Orchid ORM.
- [`kern-jobs`](https://github.com/IlyaSemenov/kern-jobs): background jobs stored in PostgreSQL, with any supported PostgreSQL client.

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
