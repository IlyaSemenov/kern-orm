# Locks

## Locking rows

To keep transactions from working on one record at once, such as from adding fields to a form at the same position, lock its row with `forUpdate`: another transaction waits to change or lock the row until the transaction ends.

```ts
await db.$transaction(async () => {
  await db.form.find(formId).forUpdate()
  const lastPosition = await db.field.where({ formId }).max("position")
  await db.field.insert({ formId, position: (lastPosition ?? 0) + 1, label: "Name" })
})
```

To lock several rows, sort them, so that two transactions lock them in one order and do not wait for each other forever:

```ts
const fields = await db.field.where({ formId }).orderBy("id").select("id", "position").forUpdate()
```

A query locks only its own rows, not the related records that it selects.
To lock a related record too, even one whose fields the query of its parent does not select, call `forUpdate` on the nested query:

```ts
const field = await db.field
  .find(fieldId)
  .select("label")
  .select(field => ({
    published: field.form.get("published").forUpdate(),
  }))
  .forUpdate()
```

The query locks the related record first and its own row after it.
When another transaction moves the field to another form meanwhile, the query reads the field and the form as they are after the move, and locks that form too, after the field.
It does not see a form created after it started, so a move to such a form makes it reject with `RequiredRelationError`; run it again then.

A query in a [value](./queries/mutations#inserting) or a [condition](./queries/filtering) locks its rows the same way:

```ts
await db.field.insert({
  formId: db.form.find(formId).get("id").forUpdate(),
  position: 1,
  label: "Name",
})
```

One statement reads the data of one moment, so the other queries of the statement do not see what another transaction committed while the lock waited.
To read such data, such as the last position in the first example, lock the row in a statement before the one that reads it.

Other locks leave more to other transactions, also in a nested query:

- `forNoKeyUpdate` is for updates of columns outside the keys of the row: it lets other transactions insert records that refer to the row.
- `forShare` keeps the row from changing while other transactions read and lock it the same way, such as to check a record that the transaction relies on.
- `forKeyShare` keeps the row from being deleted or changing its key, and lets other transactions change its other columns.

See [PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS) for which of them conflict.

To take work that no other transaction is doing, such as the next job of a queue, pass `skipLocked`, which leaves out the rows that other transactions have locked:

```ts
await db.$transaction(async () => {
  const job = await db.job
    .where({ status: "pending" })
    .orderBy("createdAt")
    .take()
    .optional()
    .select("id", "payload")
    .forUpdate({ skipLocked: true })
  // ...
})
```

A nested query with its own row lock runs before the query locks the row of its parent, so with `skipLocked` it also locks the related records of the rows that the query leaves out.
To lock only those of the rows it takes, lock them in a later statement.

To fail instead of waiting for a locked row, pass `noWait`: the query rejects with a [`lock_not_available` error](./errors).
Like any failed statement, it aborts the transaction, so to continue after it, run the query in a [nested transaction](./transactions#nested-transactions).

Run a query that locks rows in `$transaction` or `$ensureTransaction`, also in code under test: outside a transaction, the locks would end with its statement, so the query rejects, and a [test transaction](./testing) alone does not count as one.
An `update` that sets a value, a `delete`, or an `insert` holds the locks of the queries in it while it changes the rows, so it needs no transaction, such as to take the next jobs in one statement:

```ts
const jobIds = await db.job
  .where(job =>
    job.id.in(
      db.job
        .where({ status: "pending" })
        .orderBy("createdAt")
        .limit(10)
        .pluck("id")
        .forUpdate({ skipLocked: true }),
    ),
  )
  .update({ status: "running" })
  .pluck("id")
```

An [`update` without values](./queries/mutations#updating) changes no row, so it needs a transaction to hold the locks of the queries in it.

A [nested transaction](./transactions#nested-transactions) that rolls back releases the locks it took.

A query with [`distinct`](./queries/selecting#distinct-rows), [`distinctOn`](./queries/selecting#first-row-of-each-group), or [`groupBy`](./queries/grouping) cannot lock rows, and aggregates, `exists`, `distinctOn`, and `groupBy` cannot be called on a query that locks them.
`update` and `delete` lock the rows they change themselves, so their queries take no lock.

## Advisory locks

To keep processes from running the same work at once, such as an import of one file, take a lock of a key in a transaction with `$lock`: the call waits while another transaction or session holds the lock of the key, and the lock is released when the transaction ends.

```ts
await db.$transaction(async () => {
  await db.$lock(`import:${fileId}`)
  // ...
})
```

A [nested transaction](./transactions#nested-transactions) that rolls back releases the locks it took.

To skip the work while another process does it, rather than wait, take the lock with `$tryLock`, which returns whether it took the lock:

```ts
await db.$transaction(async () => {
  if (!(await db.$tryLock("cleanup"))) {
    return
  }
  // ...
})
```

To hold a lock until the transaction ends, call `$lock` and `$tryLock` in `$transaction` or `$ensureTransaction`, also in code under test: outside a transaction, the lock would end with its own statement, and a [test transaction](./testing) alone does not count as one.

In a [session](./sessions#statements-outside-a-transaction), outside its transactions, `$tryLock` holds the lock until the session ends, such as to keep the instances of an application from running the same maintenance at once:

```ts
await db.$session(async () => {
  if (await db.$tryLock("form-maintenance")) {
    await db.$query`VACUUM ANALYZE ${db.form}`
  }
})
```

To wait for the lock in a session, call `$pollLock`: it calls `$tryLock` again after a pause, which grows up to a second, until it takes the lock.

```ts
await db.$session(async () => {
  await db.$pollLock("form-maintenance")
  // ...
})
```

A session cannot wait for a lock with `$lock`, since a statement such as `CREATE INDEX CONCURRENTLY` in the session that holds the lock would wait for the statement that waits for the lock.

To stop waiting, such as after a timeout, pass a `signal`: once it aborts, `$pollLock` makes no more attempts and rejects with its reason, unless the attempt that is running takes the lock.

```ts
await db.$pollLock("form-maintenance", { signal: AbortSignal.timeout(60_000) })
```

## Lock timeout

To limit how long a query of a transaction waits for each lock, such as for a row that another transaction has [locked](#locking-rows), pass `lockTimeout` in milliseconds to `$transaction`: a query that waits longer for one lock rejects with a [`lock_not_available` error](./errors).

```ts
await db.$transaction(
  async () => {
    await db.form.find(formId).forUpdate()
    // ...
  },
  { lockTimeout: 1000 },
)
```

The timeout applies to each query of the callback, including those of its nested transactions, until the transaction ends; a nested transaction with its own `lockTimeout` then restores the timeout of the enclosing one.
Pass `0` to disable the timeout, such as in a nested transaction of a transaction with a timeout.

Like any failed statement, the rejection aborts the transaction, so to continue after it, run the query in a [nested transaction](./transactions#nested-transactions).

`$session` takes `lockTimeout` too, for the statements of the [session](./sessions#statements-outside-a-transaction).
