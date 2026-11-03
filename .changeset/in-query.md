---
"kern-orm": minor
---

Pass a query of values to `in`, such as `form.id.in(db.submission.where({ userId }).pluck("formId"))`, to match any of its values.
