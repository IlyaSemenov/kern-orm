# Sessions

## Statements outside a transaction

To run several statements on one connection outside a transaction, pass a callback to `$session`:

```ts
await db.$session(async () => {
  await db.$query`CREATE INDEX CONCURRENTLY form_name_idx ON ${db.form} (name)`
  await db.$query`VACUUM ANALYZE ${db.form}`
})
```

Every query in the callback runs on the connection of the session, outside a transaction, so a callback that fails does not undo the statements it has completed.
`$transaction` in the callback starts a transaction on the same connection.

To resolve the unqualified names of the statements in a PostgreSQL schema of your choice, such as the schema of a tenant, pass `searchPath`, as to [`$transaction`](./transactions#search-path); it applies until the session ends:

```ts
await db.$session(
  async () => {
    await db.$query`CREATE INDEX CONCURRENTLY form_name_idx ON form (name)`
    await db.$query`CREATE INDEX CONCURRENTLY field_form_id_idx ON field (form_id)`
  },
  { searchPath: ["tenant_3"] },
)
```

To limit how long a statement of a session waits for each lock, pass `lockTimeout`, as to [`$transaction`](./locks#lock-timeout); it applies until the session ends.

A statement that PostgreSQL rejects in a transaction, such as `CREATE INDEX CONCURRENTLY` or `VACUUM`, needs no session by itself: run it with `$query` outside a transaction.
Send each such statement on its own, since PostgreSQL runs a script of several statements in one transaction.

`$session` rejects inside a transaction, also a [test transaction](./testing).
To tell whether the code runs in a transaction of either kind, such as to choose a statement that a transaction accepts, call `$isInTransactionBlock()`:

```ts
if (db.$isInTransactionBlock()) {
  await db.$query`CREATE INDEX form_name_idx ON ${db.form} (name)`
} else {
  await db.$query`CREATE INDEX CONCURRENTLY form_name_idx ON ${db.form} (name)`
}
```

## Sessions that stay open

To keep a session for longer than one callback, such as to hold an [advisory lock](./locks#advisory-locks) for as long as a process works, open it with `db.$database.openSession`, run code in it with `run`, and close it when the work is done:

```ts
import type { OpenedSession } from "kern-orm"

let session: OpenedSession | undefined

async function start() {
  session = await db.$database.openSession()
  // Only the instance that takes the lock sends the reminders.
  if (await session.run(() => db.$tryLock("form-reminders"))) {
    startSendingReminders()
  } else {
    await session.close()
  }
}

async function stop() {
  // The lock is released with the session, so the work that it guards ends first.
  await stopSendingReminders()
  await session?.close()
}
```

The callback of `run` runs as the callback of [`$session`](#statements-outside-a-transaction) does: its queries to the database of the session run on the connection of the session, and a lock that it takes outside a transaction is held until the session is closed.
Call `run` any number of times, also from code that did not open the session, such as a timer.

A lost connection releases the lock, which the session learns only from a statement that fails: `db.$tryLock` of a key that it holds answers without a statement.
Before work that relies on the lock, run a statement in the session, such as `SELECT 1`.
After a [`ConnectionError`](./errors#lost-connections) on its connection, every later `run` rejects: close the session, open a new one, and take the lock again.

`close` waits for the callbacks of `run` that are running, so call it outside them.
Close every open session before `db.$database.close()`, which waits for them.
`db.$database.openSession` takes the options of `$session` and rejects inside a transaction, as `run` does.
