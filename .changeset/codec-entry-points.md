---
"kern-orm": minor
---

Add `kern-orm/db`, which exports `defineCodec` to define a PostgreSQL type without operators and the query builder, and `kern-orm/db/types`, which exports the codecs of the built-in types; `defineType(codec)` creates a type from a codec.
