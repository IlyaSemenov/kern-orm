---
"kern-db": minor
"kern-orm": minor
---

Return `DriverResult.columns` as objects with `name` and PostgreSQL type OID in `type`, including for results without rows; custom drivers and consumers of column names must use this metadata shape while values remain text or `null`.
