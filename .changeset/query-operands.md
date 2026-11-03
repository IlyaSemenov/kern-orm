---
"kern-orm": minor
---

Use the value of another query in object conditions, operators, `in` lists, and the fallback of `coalesce`, such as `db.field.where({ formId: db.form.where({ name: "Feedback" }).get("id") })`.
