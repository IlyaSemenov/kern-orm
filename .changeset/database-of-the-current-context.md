---
"kern-orm": minor
---

`bindSchema` takes a function that returns the database, such as from dependency injection, so that a module-level `db` runs each query on the database of the current context.
