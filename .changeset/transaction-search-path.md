---
"kern-orm": minor
---

Add the `searchPath` option of `transaction` and `$transaction`, which sets the search path of the transaction; a nested transaction restores the search path of the enclosing one when it ends.
