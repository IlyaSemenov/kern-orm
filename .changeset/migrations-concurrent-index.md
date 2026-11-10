---
"@kern-orm/migrations": minor
---

Add `concurrently` to `createIndex` and `dropIndex`, which build and drop the index with `CREATE INDEX CONCURRENTLY` and `DROP INDEX CONCURRENTLY` when migrations run outside a transaction.
