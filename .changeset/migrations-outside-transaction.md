---
"kern-migrations": minor
---

Add `outsideTransaction` to migration steps: changes, such as `CREATE INDEX CONCURRENTLY`, that `migrate`, `rollback`, and `redo` run outside a transaction when they are called outside one.
