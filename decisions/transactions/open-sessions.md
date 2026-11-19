# Open sessions shared by the callbacks of `run`

`openSession` opens a session whose life no callback bounds, such as of a worker that holds an advisory lock on one connection from its start to its stop and sends statements on it from a timer.
It returns an object whose `run` runs a callback in the context of the session, as `run` of an open test transaction does, so the statements of the callback, its transactions, and its locks reach the session through the async context, by the rules of the callback of `session`.

```ts
const session = await database.openSession()

// On a timer, in an async context of its own:
await session.run(async () => {
  if (await database.tryLock(`worker:${workerId}`)) {
    await database.query`UPDATE worker SET seen_at = now() WHERE id = ${workerId}`
  }
})

// When the worker stops, also while a callback runs:
await session.close()
```

Closing waits for the callbacks of `run` that are running and then ends the session, and the closing of the database waits for the open sessions.

## Statements and locks as methods of the session

The object could execute statements and take locks itself, with `session.execute(statement)` and `session.tryLock(key)`, without the async context.
Such a call names its connection, so it means the same in any context, also inside a transaction on another connection, and the object needs no rule of where `run` is allowed.
Each call is one operation, so a closing that waits for the statements already sent waits for every call, and it needs no rule for a callback that is running when the session closes.

- It is a second way to choose the connection of a statement, beside the level of the async context.
- The object repeats each member of a `Database` that code needs in a session, such as `query`, `script`, and `pollLock`, and `transaction`, whose callback needs the async context anyway.
- A query builder executes its queries through its database, so its queries, such as those of a `Db` of kern-orm, cannot run in such a session.

## A session of `session` kept open by its callback

Without `openSession`, a caller could keep a session of `session` open with a callback that waits for a promise, and run code in it with `AsyncLocalStorage.snapshot()` taken in that callback, which needs nothing new in kern-db.
The snapshot restores every store of the async context of the code that opened the session, such as its request or its tenant, rather than the session alone, so code that runs in it later reads the context of another caller.

## A closing that ends the session at once

Closing could end the session without waiting for the callbacks of `run`: it waits for the statements already sent, and a statement that a callback sends later rejects.
It cannot hang on a callback that does not settle, it can be called inside a callback, and it never rejects, and it needs no record of the calls that are running.
Code that needs its callbacks to finish can await them before it closes the session, while a closing that waits for them cannot be made to end at once.

- A callback that is running when the session closes goes on without the session: its later statements reject, and its transaction rolls back unless its own end has started, so its caller must tell the end of the session from a failure.
- Whether a callback of one statement is cut depends on how it sends the statement: `execute` sends it when it is called, while a query of `query` sends it when it is awaited, after a `close` called right behind `run`.
- A hung statement keeps either closing from ending, so ending at once holds only for a callback that waits for something other than the database.

The closing of a database waits for its running transactions and sessions too, and rejects inside one.

## Open sessions that the database closes

Closing a database could close its open sessions, as it closes its test fixtures and open test transactions, so that it never waits for a session that its owner forgot to close.
The closing waits for the running transactions, so the locks of a session would be released while a transaction that they guard still runs, and another process could take the lock and start the same work.

## `run` inside a transaction

Inside a transaction on another connection, `run` could switch to the session, so that code of a transaction takes a lock of the session or reads through it.
The statements of the callback would then leave the transaction that the calling code runs in without a sign of it at the statements, such as in a helper written for that transaction, while `session` rejects there for the same reason.
