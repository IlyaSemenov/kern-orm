---
"kern-orm": minor
---

Add `db.$ensureTransaction()` and `database.ensureTransaction()` to run a callback in the current transaction or a new one, and `db.$isInTransaction()` and `database.isInTransaction()` to tell whether code runs in a transaction.
