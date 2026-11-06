---
"kern-orm": minor
---

Add query methods `forUpdate`, `forNoKeyUpdate`, `forShare`, and `forKeyShare`, which lock the rows that a query reads, including nested queries, until its transaction ends, with options `noWait` and `skipLocked`.
