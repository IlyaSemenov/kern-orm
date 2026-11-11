---
"kern-migrations": minor
---

`migrate`, `rollback`, and `redo` reject in a transaction at `repeatable read` or `serializable` when they have migrations to run.
