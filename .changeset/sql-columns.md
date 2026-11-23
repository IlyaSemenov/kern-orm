---
"kern-db": minor
---

Add `createSqlColumns` to `kern-db/builder`, which creates the columns of a record that a statement of SQL text selects; `select` of `database.query` reads them as a nested record.
Add `cutIdentifier` to `kern-db/builder`, which cuts a name to fit a number of bytes in any server encoding.
