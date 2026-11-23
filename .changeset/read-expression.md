---
"kern-db": minor
"kern-orm": minor
---

Add the `read` option of `defineType`, the SQL expression by which queries read the values of a custom type, such as `` read: value => `extract(epoch from ${value})` `` for a `timestamptz` read as seconds since the epoch.
