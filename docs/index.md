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
      text: Database without the ORM
      link: /database/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/IlyaSemenov/kern-orm

features:
  - title: Fully typed
    details: Query results and filters are inferred from table definitions.
  - title: Related records in one query
    details: Select the related records of each row, at any depth, in a single SQL statement.
  - title: Schema per tenant
    details: Reuse table definitions and queries across PostgreSQL schemas, such as tenant schemas and a shared application schema.
  - title: Ambient transactions
    details: Queries join the current transaction without passing it around.
  - title: Tests in transactions
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

See [Related Records](./orm/queries/relations) for filtering, nesting, and reusing related records.
