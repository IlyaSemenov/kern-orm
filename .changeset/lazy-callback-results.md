---
"kern-db": patch
"kern-orm": patch
---

Fix queries running outside their transaction or session when an untyped callback returns them directly.
