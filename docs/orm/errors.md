# Errors

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

When the connection of a transaction fails, `$transaction` rejects with `TransactionConnectionError`, a `ConnectionError` whose `phase` tells whether the transaction may have been committed:

- `begin`: the transaction did not start, and its callback did not run;
- `transaction`: the transaction was rolled back, also when the callback caught the error of its query;
- `commit`: the connection failed during `COMMIT`, so the transaction may have been committed.

To retry such a transaction, run it again unless the phase is `commit`, where only a transaction that can run twice may run again:

```ts
import { TransactionConnectionError } from "kern-orm"

const createSurvey = () =>
  db.$transaction(async () => {
    const formId = await db.form.insert({ name: "Survey", published: false }).get("id")
    await db.field.insert({ formId, position: 1, label: "Name" })
  })

try {
  await createSurvey()
} catch (error) {
  // After a failure during COMMIT, the survey may exist already.
  if (error instanceof TransactionConnectionError && error.phase !== "commit") {
    await createSurvey()
  } else {
    throw error
  }
}
```

Retry the outermost transaction: a nested transaction rejects with the errors of its queries, while its enclosing transaction rolls back and rejects with `TransactionConnectionError`.
The error that the transaction rejects with otherwise, such as the error of its callback, is the `cause` of `TransactionConnectionError`.

## Failures to release a connection

To log a failure to release the connection of a transaction or a session, including a failure to release the advisory locks or restore the search path of a session, pass `onReleaseError` to `createDatabase`:

```ts
export const database = createDatabase({
  driver: postgresJsDriver(postgres(process.env.DATABASE_URL!)),
  onReleaseError: error => logger.error(error),
})
```

Such a failure does not change the result or error of the transaction or session.
Without `onReleaseError`, the failure goes to `console.error`.
