---
"kern-orm": patch
---

Fix the declarations of a module that imports only `kern-orm/types`, such as a module of column presets, which failed with TS2883 when it exported a derived type or a column.
