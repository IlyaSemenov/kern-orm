---
"kern-orm": minor
---

Add `defineSequence()` to declare PostgreSQL sequences in a schema: interpolate a sequence of a `Db`, such as `db.formNumberSeq`, into SQL as its name in the PostgreSQL schema of the `Db`, and use its `nextval()`, `currval()`, and `setval()` in SQL and queries.
