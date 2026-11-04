---
"kern-orm": minor
---

Add `literal` to select a value from code as a field of a record without sending it to PostgreSQL, such as `withHint ? field.hint : literal(null)`.
