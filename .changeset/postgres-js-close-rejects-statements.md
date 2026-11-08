---
"@kern-orm/postgres-js": patch
"@kern-orm/postgres-js-v3": patch
---

Fix a statement or script on the pool of a closing driver running instead of rejecting when it was sent right after `close()`, or, with postgres.js 3, while closing waited for transactions.
