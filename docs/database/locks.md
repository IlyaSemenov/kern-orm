# Locks

## Locking rows

To keep transactions from working on one record at once, such as from adding fields to a form at the same position, lock its row with `FOR UPDATE`: another transaction waits to change or lock the row until the transaction ends.

```ts
import * as t from "kern-db/types"

await database.transaction(async () => {
  await database.query`SELECT id FROM form WHERE id = ${formId} FOR UPDATE`
  const lastPosition = await database.query`
    SELECT max(position) FROM form_field WHERE form_id = ${formId}
  `.get(t.integer.nullable())
  await database.query`
    INSERT INTO form_field (form_id, position, label)
    VALUES (${formId}, ${(lastPosition ?? 0) + 1}, ${"Name"})
  `
})
```

A [nested transaction](./transactions#nested-transactions) that rolls back releases the locks it took.

Lock rows in `database.transaction` or `database.ensureTransaction`, also in code under test: outside a transaction, the locks end with their statement.
In a [test transaction](./testing), they last until the test ends, so a test does not show that such a transaction is missing.

To take work that no other transaction is doing, such as the next jobs of a queue, add `SKIP LOCKED`, which leaves out the rows that other transactions have locked.
A statement that changes the rows holds the locks of its subquery while it changes them, so it needs no transaction:

```ts
const jobIds = await database.query`
  UPDATE job SET status = 'running'
  WHERE id IN (
    SELECT id FROM job WHERE status = 'pending'
    ORDER BY created_at LIMIT 10
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id
`.pluck(t.uuid)
```

See [PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS) for the other locks of rows and which of them conflict.

## Advisory locks

To keep processes from running the same work at once, such as an import of one file, take a lock of a key in a transaction with `database.lock`: the call waits while another transaction or session holds the lock of the key, and the lock is released when the transaction ends.

```ts
await database.transaction(async () => {
  await database.lock(`import:${fileId}`)
  // ...
})
```

A [nested transaction](./transactions#nested-transactions) that rolls back releases the locks it took.

To skip the work while another process does it, rather than wait, take the lock with `database.tryLock`, which returns whether it took the lock:

```ts
await database.transaction(async () => {
  if (!(await database.tryLock("cleanup"))) {
    return
  }
  // ...
})
```

To hold a lock until the transaction ends, call `lock` and `tryLock` in `database.transaction` or `database.ensureTransaction`, also in code under test: outside a transaction, the lock would end with its own statement, and a [test transaction](./testing) alone does not count as one.

In a [session](./sessions#statements-outside-a-transaction), outside its transactions, `tryLock` holds the lock until the session ends, such as to keep the instances of an application from running the same maintenance at once:

```ts
await database.session(async () => {
  if (await database.tryLock("form-maintenance")) {
    await database.query`VACUUM ANALYZE form`
  }
})
```

To wait for the lock in a session, call `database.pollLock`: it calls `tryLock` again after a pause, which grows up to a second, until it takes the lock.

```ts
await database.session(async () => {
  await database.pollLock("form-maintenance")
  // ...
})
```

A session cannot wait for a lock with `lock`, since a statement such as `CREATE INDEX CONCURRENTLY` in the session that holds the lock would wait for the statement that waits for the lock.

To stop waiting, such as after a timeout, pass a `signal`: once it aborts, `pollLock` makes no more attempts and rejects with its reason, unless the attempt that is running takes the lock.

```ts
await database.pollLock("form-maintenance", { signal: AbortSignal.timeout(60_000) })
```

## Lock timeout

To limit how long a statement of a transaction waits for each lock, such as for a row that another transaction has [locked](#locking-rows), pass `lockTimeout` in milliseconds to `database.transaction`: a statement that waits longer for one lock rejects with a [`lock_not_available` error](./errors).

```ts
await database.transaction(
  async () => {
    await database.query`SELECT id FROM form WHERE id = ${formId} FOR UPDATE`
    // ...
  },
  { lockTimeout: 1000 },
)
```

The timeout applies to each statement of the callback, including those of its nested transactions, until the transaction ends; a nested transaction with its own `lockTimeout` then restores the timeout of the enclosing one.
Pass `0` to disable the timeout, such as in a nested transaction of a transaction with a timeout.

Like any failed statement, the rejection aborts the transaction, so to continue after it, run the statement in a [nested transaction](./transactions#nested-transactions).

`database.session` takes `lockTimeout` too, for the statements of the [session](./sessions#statements-outside-a-transaction).
