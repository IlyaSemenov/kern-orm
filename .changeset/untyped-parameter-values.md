---
"kern-orm": minor
---

`sql` and `db.$query` reject an object interpolated as a value, which they passed as JSON; pass JSON with `param(t.jsonb, value)`.
