# Row locks rejected by the state in types

Types reject a row lock of an aggregate query and of a query of `exists` by `LockableQueryState`.

```ts
// Chosen: a state that returns rows of its table
type LockableQueryState = SelectQueryState &
  ({ readonly aggregate: false } | { readonly value: "mapped" })

forUpdate<Q extends QueryOf<LockableQueryState>>(this: Q, options?: RowLockOptions): Q

// Alternative: a constraint of any query
forUpdate<Q extends AnySelectQuery>(this: Q, options?: RowLockOptions): Q
```

`db.submission.count().forUpdate()` is a type error, whereas with a constraint of any query it passes types and throws "forUpdate cannot be used after an aggregate".

- Compared with a constraint of any query, it adds about 35 instantiations, 13% of a query of `find` and `select`, to a call, and each of the four methods adds about 1% to a helper ([benchmark](../../benchmarks/types/queries.bench.ts)).
