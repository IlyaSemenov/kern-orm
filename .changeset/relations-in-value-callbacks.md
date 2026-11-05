---
"kern-orm": minor
---

Allow reading related records in the callbacks of `get`, `pluck`, the aggregate methods, and `update`, such as `db.form.pluck(form => form.fields.count())`.
