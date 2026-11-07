# The `aggregate` part of the state

The `aggregate` part of the state tells an aggregate query or a query of `exists` in types, so that `get`, `pluck`, the aggregate methods, and `exists` reject it.

```ts
const names = db.form.where({ published: true }).pluck("name")

names.count() // the number of the published forms
db.form.count().count() // rejected: `aggregate: true`
```

- The part adds about 4 instantiations to each method that changes the state, up to 3% of a query ([benchmark](../../benchmarks/types/queries.bench.ts)).
- Rejecting them on every query of values would spare it, but would also reject `names.count()`, such as of a query that a helper or shared code prepares.
