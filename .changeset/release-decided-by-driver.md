---
"kern-orm": minor
---

Remove `TransactionFailure` and the argument of `release` of a `Connection`: a driver decides by itself whether a released connection returns to the pool. `describeDriverContract` checks that a driver closes a released connection left in a transaction and rejects a statement on the pool that leaves a transaction open.
