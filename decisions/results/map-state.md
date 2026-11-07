# `map` without a part of the state of its own

In types, `map` sets the `value` part of the state to `"mapped"` and the `aggregate` part to `true`, with no part of its own.

```ts
// Chosen: the parts that the states of the other methods narrow
map<S extends SelectQueryState, Kind extends SelectQueryKind, R>(
  this: SelectQuery<S, Kind>,
  callback: (row: S["result"]) => R & SynchronousResult<R>,
): SelectQuery<ChangeState<S, { result: R; value: "mapped"; aggregate: true }>, Kind>

// select and clearSelect
type RecordQueryState = SelectQueryState & { readonly value: false }
// get, pluck, the aggregate methods, exists, and groupBy
type UnaggregatedQueryState = SelectQueryState & { readonly aggregate: false }

// Alternative: a part of its own, which those states name too
map<S extends SelectQueryState, Kind extends SelectQueryKind, R>(
  this: SelectQuery<S, Kind>,
  callback: (row: S["result"]) => R & SynchronousResult<R>,
): SelectQuery<ChangeState<S, { result: R; mapped: true }>, Kind>

type RecordQueryState = SelectQueryState & { readonly value: false; readonly mapped: false }
type UnaggregatedQueryState = SelectQueryState & { readonly aggregate: false; readonly mapped: false }
```

- A part of its own adds about 4 instantiations to each method that changes the state, up to 3% of a query, as the `aggregate` part does ([benchmark](../../benchmarks/types/queries.bench.ts)).
- The narrowed states would need to name it, which also rejects a function generic over the state that narrows only `value` or `aggregate`:

  ```ts
  function countRows<S extends SelectQueryState & { readonly aggregate: false }>(
    query: SelectQuery<S>,
  ) {
    return query.count() // with a part of map, S may be mapped, so count rejects it
  }
  ```
