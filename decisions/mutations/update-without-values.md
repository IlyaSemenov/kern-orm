# Update without values as a select without a lock

`update` without a column to set changes no row, so it compiles to `SELECT` of the rows of its filters, without a row lock.

```ts
await db.form.find(formId).update({})
```

```sql
-- Chosen
SELECT FROM "form" AS "form" WHERE "form"."id" = $1

-- A select that locks the rows, as the update would
SELECT FROM "form" AS "form" WHERE "form"."id" = $1 FOR NO KEY UPDATE
```

The lock would keep what an update does in a transaction: it holds the rows until the transaction ends, so a concurrent update or a conflicting lock of them waits, whatever the values of the request.
It gives this up, since:

- A lock writes the transaction into the row, which an update without values otherwise leaves untouched, and waits for a row that another transaction holds with a conflicting lock, such as for a request that changes nothing.
- Outside a transaction, the lock ends with its statement, so it holds nothing.
- A transaction that relies on the lock takes it with `forUpdate` or `forNoKeyUpdate` of a query, whatever the values.

Orchid ORM also turns such an update into a select without a lock, unless the table has its `updatedAt` timestamp, which the update sets even without values ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/update.md#empty-set)).
