---
layout: home

hero:
  name: kern-orm
  text: Typed relational queries for PostgreSQL
  tagline: Fully typed queries, related records in one query, and ambient transactions.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/IlyaSemenov/kern-orm

features:
  - title: Fully typed
    details: Query results and filters are inferred from table definitions.
  - title: Related records in one query
    details: Select the related records of each row, at any depth, in a single SQL statement.
  - title: Reusable table definitions
    details: Reuse table definitions and queries across PostgreSQL schemas, such as tenant schemas and a shared application schema.
  - title: Ambient transactions
    details: Queries join the current transaction without passing it around.
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

See [Related Records](./queries/relations) for filtering, nesting, and reusing related records.
