---
"kern-db": minor
---

Add the `lockTimeout` option of `database.transaction()`, `database.session()`, and `database.openSession()`, which sets how long their statements can wait for each lock, in milliseconds, such as `database.transaction(callback, { lockTimeout: 1000 })`.
