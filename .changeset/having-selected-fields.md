---
"kern-orm": minor
---

Pass the selected fields to the callback of `having` as its second parameter, with the operators of their types, such as `having((submission, selected) => selected.submissions.gt(1))`, or the value of a query made by `get` or `pluck`.
