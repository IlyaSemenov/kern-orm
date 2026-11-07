# Query methods typed by `this`

The methods of a query take the query they are called on from `this` rather than from the parameters of its class, so that a query is covariant in its state and its kind.

```ts
// Chosen: `where` infers the state and the kind from `this`, so `out` holds
class SelectQuery<out S extends SelectQueryState, out Kind extends SelectQueryKind = "unbound"> {
  where<S extends SelectQueryState, Kind extends SelectQueryKind>(
    this: SelectQuery<S, Kind>,
    filter: QueryWhereFilter<S>,
  ): SelectQuery<FilteredState<S>, Kind>
}

// Alternative: `where` takes the state from the class, also in the type of its parameter
class SelectQuery<S extends SelectQueryState, Kind extends SelectQueryKind = "unbound"> {
  where(filter: QueryWhereFilter<S>): SelectQuery<FilteredState<S>, Kind>
}
```

- Methods typed by the parameters of the class make TypeScript measure a query as invariant in its state, unreliably, and compare queries of different states member by member, such as the queries of the tables of `tenantDb` passed as a `Db` of the shared schema:

  ```ts
  const sharedDb: DbOf<typeof formsSchema> = tenantDb
  ```

  It takes about 50 times the instantiations for the first comparison of two `Db` types of 2 shared tables and 200 times of 12 ([benchmark](../../benchmarks/types/first-use.bench.ts)).

- Inferring the query from `this` adds about 30 instantiations to each call of `where`.
