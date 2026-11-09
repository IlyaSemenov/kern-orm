---
"kern-orm": minor
---

Remove `closesReservedConnections` from `Driver`: `describeDriverContract` runs the tests of a connection left in a transaction or lost for every driver.
