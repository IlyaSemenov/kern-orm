# Native savepoints of external transactions

Nested levels of an [external transaction](../architecture/transactions.md#external-transactions) on the client of `sql.begin` or `sql.savepoint` of postgres.js that run in a savepoint of `sql.savepoint` rather than of SQL text.

- postgres.js remembers a statement that failed on a client and rolls the scope of that client back when its callback resolves, also after a nested level of the database rolled the statement back to its savepoint of SQL text, as [drivers](../architecture/drivers.md#postgresjs) describe.
  A statement of a nested level on the client of its own savepoint of `sql.savepoint` fails that savepoint only, so the external transaction would recover from an error that a nested level rolled back, as a transaction of the database does.
- `runInOrchidTransaction` of [`@kern-orm/orchid-interop`](../architecture/orchid-interop.md#external-transactions-of-a-native-instance) then would not need to reject after a statement that a nested level rolled back.
- It requires a hook of the connection for the levels nested in the external transaction, such as an optional `savepoint(callback)` of `ExternalConnection` that runs the callback on a connection of the savepoint, and a coordinator whose nested levels run in such a callback rather than send `SAVEPOINT`, `RELEASE`, and `ROLLBACK TO` themselves.
- Decide how such a level keeps the rules of [levels](../architecture/transactions.md#levels) that rely on statements of SQL text, such as stopping to accept statements before its end, its settings, and its isolation check.
