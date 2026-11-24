---
"kern-db": minor
"kern-orm": minor
---

Add `nullableAs` to types, such as `t.jsonb.nullableAs(() => undefined)`, which reads `NULL` as `undefined` and a JSON `null` value as `null`.
