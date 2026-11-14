---
"kern-orm": patch
---

Fix the type of `select()` without keys, which added every column of the table to the result.
