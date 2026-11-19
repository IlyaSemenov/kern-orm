---
"kern-db": minor
"kern-orm": minor
---

Add `database.openSession()`, which keeps a session open across callbacks until it is closed, such as to hold an advisory lock on one connection while a worker runs.
