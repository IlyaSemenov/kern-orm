---
"kern-orm": minor
---

Add `default()` of types and columns, such as `t.text.default("draft")` or `t.uuid.default(() => randomUUID())`: inserts may omit such a column, and kern-orm inserts the value, the `sql` fragment, or the result of the function instead.
