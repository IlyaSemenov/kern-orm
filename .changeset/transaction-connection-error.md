---
"kern-orm": minor
---

Reject a transaction whose connection fails with `TransactionConnectionError`, whose `phase` tells whether it may have been committed. Such a transaction no longer commits when its callback catches the failure.
