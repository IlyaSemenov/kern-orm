---
"@kern-orm/node-postgres": minor
---

Fix a statement or script on the pool, such as `BEGIN`, leaving a transaction open for later statements of the pool: it rejects, and the transaction rolls back.
