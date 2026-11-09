---
"kern-orm": minor
---

Fix a committed transaction rejecting when releasing its connection failed; such failures go to `onReleaseError` of `createDatabase`, or to `console.error` without it.
