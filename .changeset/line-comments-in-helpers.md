---
"kern-migrations": patch
---

Fix `createTable` and `createIndex` failing, and `changeColumn` skipping the changes after a `type` or `using`, when SQL given to them ends with a line comment before more SQL.
