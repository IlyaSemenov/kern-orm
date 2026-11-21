---
"kern-db": minor
"kern-orm": minor
---

Add `database.externalTransaction()`, which runs a callback in a transaction that another library started and ends, and `postgresJsConnection()` of `kern-db/postgres-js`, which adapts the client of a transaction of postgres.js for it.
