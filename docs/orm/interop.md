# Interop with Other Libraries

An application that already runs its queries through another library, such as postgres.js or another ORM, can use kern-orm beside it, on the same data and in the same transactions.
Move such an application to kern-orm one function at a time, or call code built on Kern from a transaction of the other library, such as to apply [migrations](../migrations/getting-started) in it.

## Transactions of another library

To run queries in a transaction that another library started, pass a connection of that transaction and a callback to `db.$database.externalTransaction`:

```ts
import { postgresJsConnection } from "kern-orm/db/postgres-js"

await sql.begin(async tx => {
  const [form] = await tx`INSERT INTO form (name, published) VALUES ('Survey', false) RETURNING id`
  await db.$database.externalTransaction(postgresJsConnection(tx), async () => {
    await db.field.insert({ formId: form.id, position: 1, label: "Name" })
  })
})
```

Every query of that database in the callback runs in that transaction, including queries in called functions, and commits or rolls back with it: kern-orm neither starts nor ends the transaction.
When `db` takes the [database of the current context](./schemas#database-of-the-current-context), its function must return that database throughout the callback: a query of another database runs outside the transaction.
In the callback, `$transaction` starts a [nested transaction](./transactions#nested-transactions), and the code runs as in a transaction of kern-orm: `db.$isInTransaction()` returns `true`, and [advisory locks](./transactions#advisory-locks) last until the transaction ends.

Keep the transaction open until `externalTransaction` settles, and roll it back when it rejects.
Wait for it to settle before you start another external transaction or run queries of the other library on the same connection: a nested transaction that rolls back would undo what they wrote meanwhile.

`postgresJsConnection` takes the postgres.js client of the transaction: the client that `sql.begin` or `sql.savepoint` passes to its callback, or a connection of `sql.reserve` on which the transaction has started.
Create `sql` without transforms of the column names or rows of results, as the client of a [driver](../database/drivers#postgres-js).
Passing `sql` itself to `postgresJsConnection` throws a `TypeError`, since its statements would run outside the transaction.
When a query failed on the client of `sql.begin` or `sql.savepoint` and its callback resolves without rolling back itself, postgres.js rolls back that transaction or savepoint and rejects with the error of the query, also when a nested transaction of kern-orm rolled the query back.
So let such an error reject that callback rather than catch it inside.

For a transaction of another client, pass an object with `execute` and `executeScript` that run on its connection as those of a connection of a [custom driver](../database/custom-drivers) do.

`externalTransaction` rejects inside a transaction or a session of the database, and on a database created with `test: true`.

## Other ORMs

To share a transaction of an ORM or a query builder that runs on postgres.js, pass `postgresJsConnection` the postgres.js client of that transaction, which the library must give you.

### Orchid ORM

`@kern-orm/orchid-interop` runs the queries of Orchid on the database of kern-orm, so that both ORMs share one connection pool and the transactions that either starts; see [Orchid ORM Interop](./orchid-interop).

To run code of kern-orm, such as migrations, in a transaction of an Orchid instance that keeps its own pool and transactions, call `runInOrchidTransaction` of the same package; see [Run kern-orm code in transactions of Orchid](./orchid-interop#run-kern-orm-code-in-transactions-of-orchid).
