---
layout: home

hero:
  name: kern-orm
  text: Fully typed query builder for PostgreSQL
  tagline: Load related records in one SQL statement, run transactions without passing them around, and reuse tables across tenant schemas.
  actions:
    - theme: brand
      text: Get Started
      link: /orm/getting-started
    - theme: alt
      text: SQL with kern-db
      link: /database/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/IlyaSemenov/kern-orm

features:
  - title: Related records in one query
    details: Select the related records of each row, at any depth, in a single SQL statement, with the shape of the result inferred.
  - title: Transactions across function calls
    details: Queries join the current transaction without passing a transaction object through your code.
  - title: Schema per tenant
    details: Reuse table definitions and queries across PostgreSQL schemas, such as tenant schemas and a shared application schema.
  - title: Tests that roll back
    details: Run each test in a transaction that rolls back, with node:test, bun:test, or Vitest.
  - title: SQL when you need it
    details: Add SQL conditions to queries, or run any SQL statement and get typed rows.
  - title: Migrations
    details: Write migrations with schema helpers, SQL, or TypeScript functions, ship them in a package, and test them.
---

Load forms with their fields in one SQL statement:

```ts
const forms = await db.form
  .where({ published: true })
  .select("id", "name")
  .select(form => ({
    fields: form.fields.select("id", "label"),
  }))
// forms: { id: string; name: string; fields: { id: string; label: string }[] }[]
```

Insert a form with its fields in a transaction, which the queries of called functions join as well:

```ts
await db.$transaction(async () => {
  const formId = await db.form.insert({ name: "Survey", published: false }).get("id")
  await db.field.insertMany([
    { formId, label: "Name" },
    { formId, label: "Email" },
  ])
})
```

See [Related Records](./orm/queries/relations) and [Transactions](./orm/transactions), or start with [Getting Started](./orm/getting-started).

kern-orm is part of [Kern](./ecosystem), a family of PostgreSQL libraries for TypeScript, alongside migrations and background jobs.
