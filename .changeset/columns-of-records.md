---
"kern-orm": minor
---

Add `columnsOf`, which gives the columns of a table for a statement of `db.$query`.
`select` reads them as the record of the row, which `nullable` makes `null` without a match of an outer join.
