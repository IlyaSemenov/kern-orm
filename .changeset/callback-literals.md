---
"kern-orm": patch
---

Fix type errors on literals of an enum column returned from the callbacks of `where` and `update`, such as `update(() => ({ status: "live" }))`.
