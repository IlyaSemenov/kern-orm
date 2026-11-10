# Sessions for statements outside a transaction

`session` runs its callback on one reserved connection outside a transaction, as a level of the transaction coordinator: statements of the callback join it through the async context, as they join a transaction, its search path lasts until it ends, and `transaction` in it starts a transaction on the same connection.
Statements that PostgreSQL rejects in a transaction block, such as `CREATE INDEX CONCURRENTLY`, run on the pool one by one, but need one connection once they rely on its state: the search path that they resolve names by belongs to a connection.

```ts
await database.session(
  async () => {
    await database.script("CREATE INDEX CONCURRENTLY job_run_at_idx ON job (run_at)")
    await database.transaction(async () => {
      await database.query`UPDATE job SET run_at = now() WHERE run_at IS NULL`
    })
  },
  { searchPath: ["tenant_3"] },
)
```

It adds a kind of level to the coordinator, whose settings last for the session of PostgreSQL rather than for a transaction, so that it must restore them before its connection returns to the pool, and close a connection that it cannot restore.

## A transaction that holds a lock while the statements run on the pool

Without a session, a transaction on one connection could hold an advisory lock while the statements that PostgreSQL rejects in a transaction block run on the pool, which needs no new kind of level.

- A statement on the pool has no search path of its own: a setting needs a connection, and a script that sets it before the statement is a script of several statements, which PostgreSQL runs in one transaction, so it rejects `CREATE INDEX CONCURRENTLY` there with `25001`.
- On PostgreSQL 18, an idle transaction at `READ COMMITTED` whose last statement was sent with the extended protocol, as the drivers send every statement, keeps its `backend_xmin`, and `CREATE INDEX CONCURRENTLY` on another connection waits for its `virtualxid` until that transaction ends, which is the transaction that waits for the index.
  A session that holds a lock outside a transaction keeps no snapshot between its statements and does not delay it.
- It takes two connections, so it never completes on a pool of one.

## Access to the driver

A caller could reserve a connection of the driver of its `Database` and send the statements itself, which needs nothing new in the coordinator.
The statements of `query` and `script` in the functions that such a caller runs, such as the steps of a migration, would still go to the pool, since only the coordinator routes them, and every such caller would restore the settings and close a connection that it could not restore by itself.

## A session inside a transaction that joins it

Inside a transaction, also a test transaction, `session` could run its callback in that transaction, as `ensureTransaction` joins one, so that code with a session runs unchanged in a test.
A statement that needs a session fails there, since it runs in a transaction block after all, and the settings of the callback would have to end as those of a nested level do.
`session` rejects there instead, and `isInTransactionBlock` tells such code beforehand, so that it chooses the statements that a transaction accepts.

## Closing a connection through the driver

A connection whose settings fail to restore could be closed by an operation of the driver contract rather than by leaving it in a transaction, which every driver closes on release.
postgres.js 4 gives a reserved connection only `release()`, and closes it by the status of its transaction, so `@kern-orm/postgres-js` would implement the operation with the same `BEGIN`, and the contract of custom drivers would grow for `pg` alone.
