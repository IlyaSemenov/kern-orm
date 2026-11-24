---
"kern-db": minor
"kern-orm": minor
---

Add the types `jsonWithJsonNull` and `jsonbWithJsonNull`, which read and write a top-level JSON `null` value as `jsonNull` and `NULL` as `null`, such as `t.jsonbWithJsonNull.of<Payload | JsonNull>().nullable()`.
