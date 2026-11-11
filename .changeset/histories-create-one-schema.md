---
"kern-migrations": patch
---

Fix `migrate` failing with a duplicate key of `pg_namespace` when histories with different `tableName` create the same missing schema at once.
