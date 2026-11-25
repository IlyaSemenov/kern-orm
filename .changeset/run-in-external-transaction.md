---
"kern-db": minor
"@kern-orm/orchid-interop": minor
---

Add `runInExternalTransaction()` of kern-db, which runs a callback with a database of a transaction that another library started, and let `runInOrchidTransaction()` pass such a database to its callback when called without one.
