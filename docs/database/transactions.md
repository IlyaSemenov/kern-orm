# Transactions

::: info Using the ORM?
See [Transactions of the ORM](../orm/transactions): this page describes kern-db without the ORM.
:::

To run statements in a transaction, pass a callback to `database.transaction`: the transaction commits when the callback resolves and rolls back when it rejects.

```ts
import * as t from "kern-db/types"

await database.transaction(async () => {
  const formId = await database.query`
    INSERT INTO form (name, published) VALUES (${"Survey"}, false) RETURNING id
  `.get(t.uuid)
  await database.query`
    INSERT INTO form_field (form_id, position, label)
    VALUES (${formId}, 1, ${"Name"}), (${formId}, 2, ${"Email"})
  `
})
```

Every statement in the callback joins the transaction automatically, including statements in called functions.

A statement started from the callback after the transaction has finished fails instead of running outside of it.

When the rollback after an error fails too, such as after an error of the callback, `database.transaction` rejects with a `SuppressedError` that keeps the original error in its `suppressed` chain.

When the connection of the transaction fails, `database.transaction` rejects with a [`TransactionConnectionError`](./errors#lost-connections) instead, whose `cause` is the error it would reject with otherwise, such as that `SuppressedError`.
A transaction whose connection fails before `COMMIT`, such as in a statement of the callback, rolls back even if the callback catches the error and resolves; one whose connection fails during `COMMIT` may have been committed.

## Nested transactions

To roll back only the failed part of a transaction, call `database.transaction` inside it: the callback runs in a nested transaction, a PostgreSQL savepoint.
A failed nested transaction rolls back only its own changes, and the changes of a successful one are committed together with the enclosing transaction:

```ts
await database.transaction(async () => {
  try {
    await database.transaction(async () => {
      // ...
    })
  } catch {
    // Only the nested transaction is rolled back.
  }
  // The enclosing transaction continues.
})
```

## Joining the current transaction

To write a function of several statements that must run in a transaction, while its callers may already run one, pass its body to `database.ensureTransaction`: inside a transaction, the callback joins it without a nested transaction; outside of one, it starts a transaction.

```ts
export function clearForm(formId: string) {
  return database.ensureTransaction(async () => {
    await database.query`DELETE FROM form_field WHERE form_id = ${formId}`
    await database.query`UPDATE form SET published = false WHERE id = ${formId}`
  })
}
```

A failed callback that joined a transaction does not roll back its own changes: the enclosing transaction commits them unless it fails too.
To roll back only the changes of the callback, use a [nested transaction](#nested-transactions) instead.

To check whether the code runs in a transaction, call `database.isInTransaction()`.
For example, enqueue a job that reads the written data only outside a transaction: a job enqueued in one can start before the transaction commits, or after it rolls back, and miss the data.

A [test transaction](./testing) does not itself count as a transaction for `isInTransaction` or `ensureTransaction`, so that the tested code runs as in production: outside a `database.transaction` of the test, `database.isInTransaction()` returns `false`, and `database.ensureTransaction` starts a nested transaction.

## Locking rows

To keep transactions from working on one record at once, such as from adding fields to a form at the same position, lock its row with `FOR UPDATE`: another transaction waits to change or lock the row until the transaction ends.

```ts
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

A [nested transaction](#nested-transactions) that rolls back releases the locks it took.

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

A [nested transaction](#nested-transactions) that rolls back releases the locks it took.

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

In a [session](#statements-outside-a-transaction), outside its transactions, `tryLock` holds the lock until the session ends, such as to keep the instances of an application from running the same maintenance at once:

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

## Isolation level

To run a transaction at an isolation level other than the default of the database, pass `isolation`: `"read committed"`, `"repeatable read"`, or `"serializable"`.

```ts
await database.transaction(
  async () => {
    const lastPosition = await database.query`
      SELECT max(position) FROM form_field WHERE form_id = ${formId}
    `.get(t.integer.nullable())
    await database.query`
      INSERT INTO form_field (form_id, position, label)
      VALUES (${formId}, ${(lastPosition ?? 0) + 1}, ${"Name"})
    `
  },
  { isolation: "serializable" },
)
```

At `repeatable read` and `serializable`, PostgreSQL rejects a transaction that conflicts with a concurrent one with a [`serialization_failure` error](./errors): run the transaction again then.

A nested transaction runs at the isolation level of its transaction, which PostgreSQL sets for the whole transaction, so a nested transaction with another `isolation` rejects without running its callback.

## Search path

To run SQL whose unqualified names resolve in a PostgreSQL schema of your choice, such as SQL that creates tables in the schema of a new tenant, pass the schemas as `searchPath`:

```ts
await database.transaction(
  async () => {
    await database.script`
      CREATE SCHEMA tenant_3;
      CREATE TABLE form (id uuid PRIMARY KEY, name text NOT NULL);
    `
  },
  { searchPath: ["tenant_3", "extensions"] },
)
```

The search path applies to the statements of the callback, including those of its nested transactions, until the transaction ends; a nested transaction with its own `searchPath` then restores the search path of the enclosing one.

## Statements outside a transaction

To run several statements on one connection outside a transaction, pass a callback to `database.session`:

```ts
await database.session(async () => {
  await database.query`CREATE INDEX CONCURRENTLY form_name_idx ON form (name)`
  await database.query`VACUUM ANALYZE form`
})
```

Every statement in the callback runs on the connection of the session, outside a transaction, so a callback that fails does not undo the statements it has completed.
`database.transaction` in the callback starts a transaction on the same connection.

To resolve the unqualified names of the statements in a PostgreSQL schema of your choice, such as the schema of a tenant, pass `searchPath`, as to [`database.transaction`](#search-path); it applies until the session ends:

```ts
await database.session(
  async () => {
    await database.query`CREATE INDEX CONCURRENTLY form_name_idx ON form (name)`
    await database.query`CREATE INDEX CONCURRENTLY form_field_form_id_idx ON form_field (form_id)`
  },
  { searchPath: ["tenant_3"] },
)
```

A statement that PostgreSQL rejects in a transaction, such as `CREATE INDEX CONCURRENTLY` or `VACUUM`, needs no session by itself: run it with `database.query` outside a transaction.
Send each such statement on its own, since PostgreSQL runs a script of several statements in one transaction.

`database.session` rejects inside a transaction, also a [test transaction](./testing).
To tell whether the code runs in a transaction of either kind, such as to choose a statement that a transaction accepts, call `database.isInTransactionBlock()`:

```ts
if (database.isInTransactionBlock()) {
  await database.query`CREATE INDEX form_name_idx ON form (name)`
} else {
  await database.query`CREATE INDEX CONCURRENTLY form_name_idx ON form (name)`
}
```
