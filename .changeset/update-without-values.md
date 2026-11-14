---
"kern-orm": minor
---

`update` without a value to set, such as `update({})`, changes no record and resolves to the number or the selected fields of the records it chooses, instead of throwing.
