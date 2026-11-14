---
"kern-orm": minor
---

Add `findTableMismatches` to `kern-orm/testing`, which checks the tables of a `Db` against its PostgreSQL schema, such as after migrating in a test.
