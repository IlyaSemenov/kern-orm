# A thenable of a callback resolved in its level

The callback of a level, such as of `transaction` or `session`, returns a promise by its type.
Code that types do not check, such as JavaScript or a callback behind `any`, can return another thenable instead, and a query is one: it sends its statement when its `then` is called.

```js
// The query is not sent yet when the callback returns.
await database.transaction(() => database.query`UPDATE job SET run_at = now()`)
```

Once `run` of an `AsyncLocalStorage` returns, its caller is back in the context it had before, while a job started inside `run` keeps the context of the level.
A level resolves the result of its callback inside `run`, with `Promise.resolve(callback())` in the function that the storage runs, so that the job that calls the `then` of the thenable starts in the level and the statement runs in it, as with `async () => query`.
`Promise.resolve` returns a promise whose constructor is `Promise` of its realm as it is, so code that awaits a callback that returned such a promise, already fulfilled, continues after 1 microtask, as without it; a promise of a subclass or of another realm resolves through its `then`, as a thenable does.

## Awaiting the result where the level is awaited

The level could await what `run` of the storage returns, which needs nothing in the level.
The `then` of the thenable is then called in the context of the code that started the level, so the statement runs outside it: on the pool, where it commits whether the transaction commits or not, while an enclosing level rejects it beside its nested level.
The types reject such a callback, but where they do not apply, a statement that ran on the pool may go unnoticed and commit on its own.

- Orchid ORM 1.78.61 (pqb 0.73.50) on postgres.js does this in an outermost `transaction`, started outside an async state of Orchid: a query that its callback returns without `async` runs outside the transaction, such as at `read committed` in a transaction started at `serializable` ([source](https://github.com/romeerez/orchid-orm/blob/pqb%400.73.50/packages/pqb/src/adapters/adapter.ts#L765-L807)).

## Rejecting a thenable that is not a promise

The level could reject with `TypeError` when its callback returns a thenable that is not a promise, as the callbacks of `map` and `transform` of a query reject one, so that the runtime accepts what the types accept.
Those callbacks are synchronous, so a thenable there has no result to give, while the callback of a level is asynchronous, and `() => query` reads as `async () => query`, which runs.
The level would also roll back work that has one meaning, and would have to tell a promise from another thenable, also a promise of another realm or of a subclass whose `then` starts its work.

## An async function around every callback

`storage.run(level, async () => callback())` resolves the thenable in the level too, without `Promise.resolve`.
It creates a promise for every level, and code that awaits a callback that returned a fulfilled promise whose constructor is `Promise` of its realm continues after 3 microtasks instead of 1, also for the callbacks that need nothing.
