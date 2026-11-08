---
"kern-orm": minor
---

Add `onConflict(...columns).doNothing()` after `insert` and `insertMany` to skip records that conflict with existing ones on a key.
