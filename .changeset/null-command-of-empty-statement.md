---
"kern-orm": patch
---

Fix the type of `command` of `DriverResult`, which omitted `null` for a statement without a command tag, such as an empty text, and check that value in `describeDriverContract`.
