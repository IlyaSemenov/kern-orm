# Database Errors

To handle a statement that PostgreSQL rejects, such as an insert of a form whose name is taken, check its [condition](https://www.postgresql.org/docs/current/errcodes-appendix.html) with `isQueryError` and compare the name of the violated constraint:

```ts
import { isQueryError } from "kern-orm"

try {
  await db.form.insert({ name, published: false })
} catch (error) {
  if (isQueryError(error, "unique_violation") && error.constraint === "form_name_key") {
    throw new Error(`A form named ${name} already exists`)
  }
  throw error
}
```

The condition of a class, such as `integrity_constraint_violation`, matches every condition of the class, as in `EXCEPTION WHEN` of PL/pgSQL.

Such an error is a `QueryError`.
To check a [SQLSTATE](https://www.postgresql.org/docs/current/errcodes-appendix.html) of your own, such as of `RAISE ... USING ERRCODE` in a function, compare `code` of `QueryError`: `error instanceof QueryError && error.code === "U0001"`.
The error of your PostgreSQL client is the `cause` of `QueryError`, with the other fields of the error, such as `detail`.

To insert a record only when it does not exist yet, or to update the existing one, use [`onConflict`](./queries/mutations#records-that-already-exist) instead.

A rejected statement aborts its transaction: to continue the transaction after it, run the statement in a [nested transaction](./transactions#nested-transactions).

## Lost connections

A query rejects with `ConnectionError` when its connection fails, such as when the server restarts or the network breaks, or when the client gives up waiting for the result.
Whether PostgreSQL ran the statement is unknown then, so retry only a change that can run twice, such as an insert with [`onConflict`](./queries/mutations#records-that-already-exist).

```ts
import { ConnectionError } from "kern-orm"

try {
  await db.form.find(formId).update({ published: true })
} catch (error) {
  if (error instanceof ConnectionError) {
    // Setting the same value again does no harm.
    await db.form.find(formId).update({ published: true })
  } else {
    throw error
  }
}
```

When `$transaction` rejects with `ConnectionError`, the transaction may have been committed, such as when its connection fails during `COMMIT`.
When the connection fails while the callback runs, the rollback fails too, so `$transaction` rejects with a `SuppressedError` whose `error` is the `ConnectionError` of the rollback; such a transaction was not committed.
