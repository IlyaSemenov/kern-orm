---
"kern-orm": minor
---

Add `of<T>()` to every type to narrow its values in TypeScript, such as `t.text.of<"draft" | "published">()` for a column that a `CHECK` constraint limits.
