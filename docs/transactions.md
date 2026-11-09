# Transactions

To run queries in a transaction, pass a callback to `$transaction`: the transaction commits when the callback resolves and rolls back when it rejects.

```ts
await db.$transaction(async () => {
  const formId = await db.form.insert({ name: "Survey", published: false }).get("id")
  await db.field.insertMany([
    { formId, position: 1, label: "Name" },
    { formId, position: 2, label: "Email" },
  ])
})
```

Every query in the callback joins the transaction automatically, including queries in called functions.
The transaction belongs to the database, so it also covers [other schemas](./multiple-schemas) bound to it.

A query started from the callback after the transaction has finished fails instead of running outside of it.

When the rollback after an error fails too, such as after an error of the callback, `$transaction` rejects with a `SuppressedError` that keeps the original error in its `suppressed` chain.

When the connection of the transaction fails, `$transaction` rejects with a [`TransactionConnectionError`](./errors#lost-connections) instead, whose `cause` is the error it would reject with otherwise, such as that `SuppressedError`.
A transaction whose connection fails before `COMMIT`, such as in a query of the callback, rolls back even if the callback catches the error and resolves; one whose connection fails during `COMMIT` may have been committed.

## Nested transactions

To roll back only the failed part of a transaction, call `$transaction` inside it: the callback runs in a nested transaction, a PostgreSQL savepoint.
A failed nested transaction rolls back only its own changes, and the changes of a successful one are committed together with the enclosing transaction:

```ts
await db.$transaction(async () => {
  try {
    await db.$transaction(async () => {
      // ...
    })
  } catch {
    // Only the nested transaction is rolled back.
  }
  // The enclosing transaction continues.
})
```

## Joining the current transaction

To write a function of several queries that must run in a transaction, while its callers may already run one, pass its body to `$ensureTransaction`: inside a transaction, the callback joins it without a nested transaction; outside of one, it starts a transaction.

```ts
export function clearForm(formId: string) {
  return db.$ensureTransaction(async () => {
    await db.field.where({ formId }).delete()
    await db.form.find(formId).update({ published: false })
  })
}
```

A failed callback that joined a transaction does not roll back its own changes: the enclosing transaction commits them unless it fails too.
To roll back only the changes of the callback, use a [nested transaction](#nested-transactions) instead.

To check whether the code runs in a transaction, call `$isInTransaction()`.
For example, enqueue a job that reads the written data only outside a transaction: a job enqueued in one can start before the transaction commits, or after it rolls back, and miss the data.

A [test transaction](./testing) does not itself count as a transaction for `$isInTransaction` or `$ensureTransaction`, so that the tested code runs as in production: outside a `$transaction` of the test, `$isInTransaction()` returns `false`, and `$ensureTransaction` starts a nested transaction.

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
Like any failed statement, it aborts the transaction, so to continue after it, run the query in a [nested transaction](#nested-transactions).

Run a query that locks rows in `$transaction` or `$ensureTransaction`, also in code under test: outside a transaction, the locks would end with its statement, so the query rejects, and a [test transaction](./testing) alone does not count as one.
An `update`, `delete`, or `insert` holds the locks of the queries in it while it changes the rows, so it needs no transaction, such as to take the next jobs in one statement:

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

A [nested transaction](#nested-transactions) that rolls back releases the locks it took.

A query with [`distinct`](./queries/selecting#distinct-rows), [`distinctOn`](./queries/selecting#first-row-of-each-group), or [`groupBy`](./queries/grouping) cannot lock rows, and aggregates, `exists`, `distinctOn`, and `groupBy` cannot be called on a query that locks them.
`update` and `delete` lock the rows they change themselves, so their queries take no lock.

## Advisory locks

To keep processes from running the same work at once, such as an import of one file, take a lock of a key in a transaction with `$lock`: the call waits while another transaction holds the lock of the key, and the lock is released when the transaction ends.

```ts
await db.$transaction(async () => {
  await db.$lock(`import:${fileId}`)
  // ...
})
```

A [nested transaction](#nested-transactions) that rolls back releases the locks it took.

Call `$lock` in `$transaction` or `$ensureTransaction`, also in code under test: outside a transaction, the lock would end with its own statement, and a [test transaction](./testing) alone does not count as one.

## Search path

To run SQL whose unqualified names resolve in a PostgreSQL schema of your choice, such as SQL that creates tables in the schema of a new tenant, pass the schemas as `searchPath`:

```ts
await db.$transaction(
  async () => {
    await db.$script(`
      CREATE SCHEMA tenant_3;
      CREATE TABLE form (id uuid PRIMARY KEY, name text NOT NULL);
    `)
  },
  { searchPath: ["tenant_3", "extensions"] },
)
```

The search path applies to the queries of the callback, including those of its nested transactions, until the transaction ends; a nested transaction with its own `searchPath` then restores the search path of the enclosing one.
