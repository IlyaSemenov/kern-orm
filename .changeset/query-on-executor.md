---
"kern-db": minor
"kern-orm": minor
---

Add `queryOn`, which starts a query of SQL text on a driver, a connection, or any other object with `execute`, such as ``queryOn(connection)`SELECT count(*) FROM job`.get(t.integer)``, with the template and the results of `database.query`.
