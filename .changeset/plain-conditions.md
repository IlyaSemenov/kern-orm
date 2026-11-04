---
"kern-orm": patch
---

Fix invalid conditions such as `false` or a `Date` being treated as `TRUE` instead of throwing an error in `where`, `and`, `or`, and `not`.
