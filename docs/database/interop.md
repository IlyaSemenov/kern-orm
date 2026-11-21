# Interop with Other Libraries

::: info Using the ORM?
See [Interop of the ORM](../orm/interop): this page describes kern-db without the ORM.
:::

An application that already runs its statements through another library, such as postgres.js or an ORM, can use kern-db beside it, on the same data and in the same transactions.
Move such an application to kern-db one function at a time, or call code built on kern-db from a transaction of the other library, such as to apply [migrations](../migrations/getting-started) in it.

## Transactions of another library

To run statements of the database in a transaction that another library started, pass a connection of that transaction and a callback to `database.externalTransaction`:

```ts
import { postgresJsConnection } from "kern-db/postgres-js"

await sql.begin(async tx => {
  const [form] = await tx`INSERT INTO form (name, published) VALUES ('Survey', false) RETURNING id`
  await database.externalTransaction(postgresJsConnection(tx), async () => {
    await database.query`
      INSERT INTO form_field (form_id, position, label) VALUES (${form.id}, 1, ${"Name"})
    `
  })
})
```

Every statement that the callback runs through `database` runs in that transaction, including statements in called functions, and commits or rolls back with it: the database neither starts nor ends the transaction.
In the callback, `database.transaction` starts a [nested transaction](./transactions#nested-transactions), and the code runs as in a transaction of the database: `database.isInTransaction()` returns `true`, and [advisory locks](./transactions#advisory-locks) last until the transaction ends.

Keep the transaction open until `database.externalTransaction` settles, and roll it back when it rejects.
Wait for it to settle before you start another external transaction or run statements of the other library on the same connection: a nested transaction that rolls back would undo what they wrote meanwhile.

`postgresJsConnection` takes the postgres.js client of the transaction: the client that `sql.begin` or `sql.savepoint` passes to its callback, or a connection of `sql.reserve` on which the transaction has started.
Create `sql` without transforms of the column names or rows of results, as the client of a [driver](./drivers#postgres-js).
Passing `sql` itself to `postgresJsConnection` throws a `TypeError`, since its statements would run outside the transaction.
When a statement failed on the client of `sql.begin` or `sql.savepoint` and its callback resolves without rolling back itself, postgres.js rolls back that transaction or savepoint and rejects with the error of the statement, also when a nested transaction of the database rolled the statement back.
So let such an error reject that callback rather than catch it inside.

For a transaction of another client, pass an object with `execute` and `executeScript` that run on its connection as those of a connection of a [custom driver](./custom-drivers) do.

`database.externalTransaction` rejects inside a transaction or a session of the database, and on a database created with `test: true`.

## ORMs and query builders

To share a transaction of an ORM or a query builder that runs on postgres.js, pass `postgresJsConnection` the postgres.js client of that transaction, which the library must give you.

### Orchid ORM

An application of Orchid ORM that moves to kern-orm shares its connection pool and transactions through `@kern-orm/orchid-interop`; see [Orchid ORM Interop](../orm/orchid-interop).
