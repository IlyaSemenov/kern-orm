# External connection of node-postgres

A function of `kern-db/node-postgres`, as `postgresJsConnection` of `kern-db/postgres-js`, that creates the `ExternalConnection` of an [external transaction](../architecture/transactions.md#external-transactions) over a client of node-postgres on which another library has started a transaction, such as a `PoolClient` after its `BEGIN`.

- Run statements and scripts on it as the driver of node-postgres runs them on an acquired connection, with the same text parameters, results, and errors.
- Decide which states of `getTransactionStatus()` of the client the function accepts, as the driver of node-postgres reads it to recognize an idle connection: it can reject a client outside a transaction, as `postgresJsConnection` rejects the client of the pool.
  Decide separately whether it accepts a transaction that a failed statement aborted.
- node-postgres remembers no failed statement, unlike postgres.js, so a nested level that rolled a failed statement back leaves the transaction committable.
- A layer for a library on node-postgres, such as Orchid ORM on `orchid-orm/node-postgres`, would read the client of its current transaction as `runInOrchidTransaction` of [`@kern-orm/orchid-interop`](../architecture/orchid-interop.md#external-transactions-of-a-native-instance) reads that of postgres.js.
