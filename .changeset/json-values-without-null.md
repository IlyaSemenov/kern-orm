---
"kern-orm": minor
---

Require `json` and `jsonb` columns that are not `nullable` and have no default in inserts and reject `null` as their value in types, and keep `null` among the values that `transform` returns for a type that accepts `null`, such as a `nullable` JSON column.
