---
"kern-db": minor
"kern-orm": minor
---

Add `catch()` and `finally()` of a Promise to the queries that execute when awaited: the queries of a `Db`, such as `db.form.select("id")` and `db.$query`, and those of `database.query` and `queryOn`.
