# Transactions

To run queries in a transaction, pass a callback to `$transaction`: the transaction commits when the callback resolves and rolls back when it rejects.

```ts
await db.$transaction(async () => {
  const form = await db.form.find(formId).select("id", "name")
  const fields = await db.field.where({ formId }).select("id", "label")
})
```

Every query in the callback joins the transaction automatically, including queries in called functions.
The transaction belongs to the database, so it also covers [other schemas](./multiple-schemas) bound to it.

A query started from the callback after the transaction has finished fails instead of running outside of it.

When cleaning up after an error fails too, such as a rollback after an error of the callback, `$transaction` rejects with a `SuppressedError` that keeps the original error in its `suppressed` chain.

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
