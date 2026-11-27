---
"kern-db": minor
"kern-orm": minor
---

Add the built-in type `timestamptzPortable`, which reads a `timestamptz` with microsecond precision under any `DateStyle` and `TimeZone` settings and binds it back as the same instant under any `DateStyle`.
