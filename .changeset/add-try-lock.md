---
"kern-orm": minor
---

Add `db.$tryLock()` and `database.tryLock()`, which take an advisory lock without waiting, in a transaction or a session, and tell whether they took it.
