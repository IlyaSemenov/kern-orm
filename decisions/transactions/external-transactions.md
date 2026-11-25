# External transactions as a level of the coordinator

`externalTransaction` of a `Database` runs its callback in a level of the transaction coordinator over a connection whose transaction other code started and ends, such as a transaction of another library that the application keeps.
The statements of the callback join it through the async context, as they join a transaction, and its nested transactions are savepoints with their settings, locks, and isolation check.

```ts
await sql.begin(async tx => {
  await database.externalTransaction(postgresJsConnection(tx), async () => {
    await migrate(database, history)
  })
})
```

It adds a kind of level that sends no `BEGIN`, `COMMIT`, or `ROLLBACK` and never releases its connection, and a contract with the owner of the transaction that the coordinator cannot check: the transaction stays open until the promise of `externalTransaction` settles.

## A driver over the transaction

A driver whose connections run statements in the transaction of its owner would need no new kind of level: `createDatabase` takes it as any driver.

- `transaction` sends `BEGIN` and `COMMIT` on a connection of the driver, which the driver would have to recognize by their text and drop, so that `COMMIT` of the database does not commit the transaction of its owner.
- A statement outside a transaction runs on the pool of a driver, which such a driver does not have: it would run in the transaction too, and `isInTransactionBlock` would answer `false` there, so that a call that chooses its statements by it, such as of the migrator, would start a session and `CREATE INDEX CONCURRENTLY` in a transaction block.

## A target of its own in the migrator

The migrator, the first consumer, could take the executor of the owner as a target and run its statements on it, without a change of `kern-db`.

- A migration takes the database of its target, with `query` of `kern-db` and its types, so the target would implement the queries of SQL text over the executor.
- The nested level of a call, with its search path that it restores, its advisory lock, and its isolation check, would be written again over the executor, apart from the levels of the coordinator that the tests of `kern-db` cover.
- Every other package on top of `kern-db` would need a target of its own.

## A database of the transaction alone

A function that creates a `Database` of the external transaction, without a pool, instead of `externalTransaction` of an existing database, would serve an application that has no database of `kern-db`, which otherwise creates one over a driver only to call `externalTransaction`.

- Every member of such a database that needs a pool would reject: statements outside the transaction, `session`, and `openSession`.
- The schemas that the application bound to its own database would not join the transaction: it would bind them again to the database of each transaction.

So `kern-db` gives both: `externalTransaction` for an application with a database, and `runInExternalTransaction`, which runs a callback with such a database, for an application without one, such as an application of Orchid ORM that applies the migrations of a package in its test transactions.

## The query executor of the owner as the connection

The connection could be the query executor that a library gives for its current transaction, such as `query(text, values)` of an adapter of Orchid ORM, rather than a connection by the contract of a driver.

- Such an executor serializes parameters by the types that PostgreSQL resolves for them: through the adapter of Orchid ORM 1.78.61 on postgres.js 4, the text `{"a":1}` of a parameter of `jsonb` is stored as a JSON string rather than as an object.
- It parses values by their types, such as numbers, Booleans, and JSON, while the types of `kern-db` decode text.
- It gives no command tag.

The contract of a driver leaves reaching the client of the transaction to the code that knows the library.
