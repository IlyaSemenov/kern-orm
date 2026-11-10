# Values before an update

PostgreSQL 18 lets `RETURNING` read a changed row before and after the change as `old` and `new`, such as `RETURNING old.published, new.published`; the fields selected after `update` give only the values after it.

- Decide how the callback of `select` after `update` refers to the values before it, such as by a second argument of the columns of the row before the update.
- Decide whether `insert` takes them, where `old` is `NULL` without an upsert conflict, and `delete`, where `new` is `NULL`.
- PostgreSQL before 18 rejects `old` and `new` in `RETURNING`.
