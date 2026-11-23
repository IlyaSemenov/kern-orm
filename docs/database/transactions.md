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
A callback can also return a query without `async`, such as ``() => database.query`UPDATE form SET published = true WHERE id = ${formId}` ``, and its statement runs in the transaction.

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

In a [transaction of another library](./interop#transactions-of-another-library), that library decides what it commits after a statement failed.

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
For example, call another service, such as a payment provider, only outside a transaction: a transaction that rolls back after the call cannot undo it.

A job enqueued through another connection or service does not join the transaction either, so it can start before the transaction commits, or after it rolls back, and miss the data.
To enqueue a job in the transaction, so that it starts only once the transaction commits, keep the jobs in the same database, such as with [kern-jobs](https://ilyasemenov.github.io/kern-jobs/database-clients#kern-orm-and-kern-db), whose enqueues join `database.transaction`.

A [test transaction](./testing) does not itself count as a transaction for `isInTransaction` or `ensureTransaction`, so that the tested code runs as in production: outside a `database.transaction` of the test, `database.isInTransaction()` returns `false`, and `database.ensureTransaction` starts a nested transaction.

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
When you pass `isolation`, do not change the level in the transaction from SQL, such as with `SET TRANSACTION`: a nested transaction is checked against the `isolation` that you passed.

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

## Lock timeout

To limit how long a statement of the transaction waits for each lock, pass `lockTimeout`; see [Lock timeout](./locks#lock-timeout).

## Transactions of another library

To run statements in a transaction that another library started, such as postgres.js or an ORM, see [Interop with Other Libraries](./interop#transactions-of-another-library).
