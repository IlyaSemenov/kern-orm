---
"kern-orm": patch
---

Fix a type being accepted where a type of more accepted values is expected, such as `t.text` as a `Type<string, string | number>`.
