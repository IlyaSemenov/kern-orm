---
"kern-orm": minor
---

Add `kern-orm/db`, which exports `defineType` to define a PostgreSQL type without operators and the query builder, and `kern-orm/db/types`, which exports the built-in types without operators; `defineType()` of `kern-orm` creates a type with operators from such a type.
