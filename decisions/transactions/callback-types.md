# Callbacks of levels typed by `PromiseLike`

Every callback of a level, such as of `transaction`, `session`, `run` of an open session, `testTransaction`, and the seed of a test fixture, has the type `() => PromiseLike<T>`, so that a callback returns a query directly, such as `db.$transaction(() => db.post.insert(values))`.
A transaction, a session, and `run` return `Promise<T>`, and a test fixture has `T` as its `data`.
[The level resolves such a query in its context](thenables-of-callbacks.md), so the query runs in the level.

The type rejects a result that does not fit `PromiseLike<T>`: a value; an unbound query of the ORM, whose `then` is `undefined`, so that the level would resolve with the query itself, and a union of a bound and an unbound query; and a conflict target of `onConflict`, whose `then` takes no callback and throws, since the target needs an action first.

## Taking a value too

`() => T | PromiseLike<T>` would also take a synchronous callback, such as `() => 1`.
It would take an unbound query as a value: the level would resolve with the query itself and execute nothing.

## Keeping `() => Promise<T>`

A callback would need `async` to return a query, `async () => query`, which runs as `() => query` does.
Both types cost the same to check for a callback that returns a promise: 395 instantiations for a transaction of an async callback that returns a query, with either type, by `bench:types` on TypeScript 7 ([benchmark](../../benchmarks/types/queries.bench.ts)).

## A thenable with a `then` that is not generic

A type of its own, such as `{ then(onFulfilled: (value: T) => unknown): unknown }`, would cost less to check against a query than `PromiseLike<T>`, whose generic `then` the checker relates to the generic `then` of the query.
By `bench:types` on TypeScript 7, a transaction of a callback that returns a query of a state that the program has not yet compared costs 527 instantiations with `PromiseLike`, and 473 with such a type in its place, while a transaction of an async callback costs 395 with either type ([benchmark](../../benchmarks/types/queries.bench.ts)).
By `profile:types` on TypeScript 6, which counts each further copy of the same call ([profiling](../../benchmarks/types/PROFILING.md)), each further copy of a call with a query of the same state costs about 39 instantiations with `PromiseLike` for a callback that returns the query, and about 41 for an async callback.
The public signatures would then name a type of the package rather than the standard `PromiseLike`.
