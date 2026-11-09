---
"@kern-orm/node-postgres": patch
---

Reuse a connection left idle after PostgreSQL rejects `COMMIT`, such as for a deferred constraint, instead of reconnecting for the next statement.
