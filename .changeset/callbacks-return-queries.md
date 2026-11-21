---
"kern-db": minor
"kern-orm": minor
"@kern-orm/orchid-interop": minor
---

Allow the callbacks of transactions, sessions, test helpers, and `runInOrchidTransaction()` to return a query directly without `async`, such as `db.$transaction(() => db.post.insert(values))`.
