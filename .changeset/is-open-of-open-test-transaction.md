---
"kern-db": minor
"kern-orm": minor
---

Add `isOpen` to an open test transaction, which tells whether it still runs callbacks or was closed, such as rolled back by the test transaction of the next browser test.
