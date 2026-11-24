# A query as a thenable, not a `Promise`

A query that executes when awaited, a bound query of the ORM or a query of SQL text, has `then`, `catch`, and `finally` that fit those of a Promise, with the reason of a rejection typed `unknown`, and no `Symbol.toStringTag`, so it fits `PromiseLike` and not `Promise`.

```ts
/** Reports the rejection of `promise` and returns it to the caller. */
function report<T>(promise: Promise<T>): Promise<T> {
  promise.catch(logError)
  return promise
}

const publish = db.form.find(formId).update({ published: true })

// Chosen: a query is a type error, and `then()` executes it once and gives its Promise
await report(publish.then())

// Alternative: the query fits `Promise<number>`, and the update runs twice
await report(publish)
```

Building a query executes nothing, and each call of `then`, `catch`, and `finally` executes it again, so that it can be built in advance and awaited in several places; a query that a `Database` executes runs in the transaction or session that is current at the call.
A Promise has started where it was created and settles once, and code that takes one relies on both: it attaches a handler and returns the same Promise, as `report` does, awaits it twice, or awaits it later, outside the transaction that created it.
With a query, such code runs the statement once for each handler, also of an insert, or outside the transaction.

A query does not fit a parameter typed `Promise<T>`, where users pass `query.then()`, or the result of a function typed `() => Promise<T>`, where they write `() => query.then()` or `async () => query`.
A parameter typed `() => T | Promise<T>` takes a function that returns a query with the query itself as `T`.

## A query that fits `Promise`

With a `Symbol.toStringTag`, a query would fit `Promise` in types, so users would pass it wherever a `Promise` is declared, such as from a function `() => Promise<T>` that is not async, and `() => T | Promise<T>` would infer `T` as its result.
Types would then take a query in code such as `report`, which runs it twice.

- Drizzle ORM does this: `QueryPromise` implements `Promise`, and each call of `then`, `catch`, and `finally` executes the query ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/query-promise.ts)).
- knex does this: a builder declares `then`, `catch`, and `finally` of `Promise` and a `Symbol.toStringTag` ([types](https://github.com/knex/knex/blob/3.3.0/types/index.d.ts)), and each call of them runs the query ([source](https://github.com/knex/knex/blob/3.3.0/lib/builder-interface-augmenter.js)).

## A query that executes once

A query that keeps the promise of its first execution for the later calls would settle once, as a Promise does.
Awaiting it again, such as a query built at module level, would give the result of its first execution instead of executing it in the transaction that is current then.

- Prisma ORM does this: `PrismaPromise` extends `Promise`, sends its request with the first call of `then`, `catch`, or `finally`, and a later call does not send it again ([source](https://github.com/prisma/prisma/blob/7.10.1/packages/client/src/runtime/core/request/createPrismaPromise.ts)).
