---
"kern-orm": minor
---

Read ordinary and materialized PostgreSQL views through typed queries with `defineView`.

`createTableFactory(options)` returns `{ defineTable, defineView }` with a shared column naming convention.
Change `const defineTable = createTableFactory(options)` to `const { defineTable } = createTableFactory(options)`.
