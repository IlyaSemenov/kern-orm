---
"kern-orm": minor
---

Add the `lockTimeout` option of `db.$transaction()` and `db.$session()`, which sets how long their queries can wait for each lock, in milliseconds, such as `db.$transaction(callback, { lockTimeout: 1000 })`.
