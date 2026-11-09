---
"kern-orm": minor
"@kern-orm/postgres-js": minor
"@kern-orm/postgres-js-v3": minor
"@kern-orm/node-postgres": minor
---

Add `closesReservedConnections` to `Driver`, which tells whether a driver closes a reserved connection that it cannot return to the pool, `false` for postgres.js 3; `describeDriverContract` reads it from the driver instead of its option.
