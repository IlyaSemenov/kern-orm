---
"kern-orm": minor
---

Replace `database.bind(schema, options)` with `bindSchema(schema, database, options)`, which also accepts databases created by `createDatabase` from `kern-orm/db`.
