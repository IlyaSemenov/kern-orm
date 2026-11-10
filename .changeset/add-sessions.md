---
"kern-orm": minor
---

Add `db.$session()` and `database.session()`, which run statements on one connection outside a transaction, with a search path of their own, and `db.$isInTransactionBlock()` and `database.isInTransactionBlock()`, which tell whether a statement runs in a transaction block.
