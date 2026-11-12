---
"kern-db": minor
"kern-orm": minor
---

Fix test transactions failing every later query of a test once a query of the tested code outside a transaction failed, such as an insert that violates a unique constraint, and queries of a test failing beside a running transaction of the tested code; a test that passes also waits for the transactions that it started without awaiting them instead of failing.
