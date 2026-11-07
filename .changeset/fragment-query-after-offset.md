---
"kern-orm": patch
---

Fix a query with an offset that returned a row its offset should skip when a nested query aggregated the rows of the query in a SQL fragment through a query in the fragment, such as ``sql`count(${db.form.where({ id }).get(() => form.id)})` ``.
