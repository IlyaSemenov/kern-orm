# The members of a bound query as interfaces

`then`, `catch`, and `finally` of a bound query are the interfaces `BoundQueryThen`, `BoundQueryCatch`, and `BoundQueryFinally` of its state, which the conditional types of the kind name, rather than function types written in those conditional types.

```ts
// Chosen: the conditional type names an interface
export interface BoundQueryThen<S extends QueryState> {
  <R1 = QueryResult<S>, R2 = never>(
    onFulfilled?: ((result: QueryResult<S>) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2>
}

export type QueryThen<S extends QueryState, Kind extends SelectQueryKind> = [Kind] extends ["bound"]
  ? BoundQueryThen<S>
  : [Kind] extends ["unbound"]
    ? undefined
    : ((onFulfilled: never) => unknown) | undefined

// Alternative: the conditional type holds the function type
export type QueryThen<S extends QueryState, Kind extends SelectQueryKind> = [Kind] extends ["bound"]
  ? <R1 = QueryResult<S>, R2 = never>(
      onFulfilled?: ((result: QueryResult<S>) => R1 | PromiseLike<R1>) | null,
      onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
    ) => Promise<R1 | R2>
  : [Kind] extends ["unbound"]
    ? undefined
    : ((onFulfilled: never) => unknown) | undefined
```

A use of a helper instantiates the types of the members of its query.
By `bench:types` on TypeScript 7, the interface of `then` takes 97 to 103 instantiations, 7% to 10%, off each use of a helper, and the interfaces of `catch` and `finally` take 16 to 26 off it ([benchmark](../../benchmarks/types/queries.bench.ts)).

- Function types written in the conditional types cost 1 instantiation less in each of the 66 of the 106 benchmarks that the interface of `then` adds to, at most 1% of a benchmark.
  They need no names of their own: with the interfaces, the declarations of a consumer that name such a member, such as of `query.then.bind(query)`, name an interface, so the root of `kern-orm` exports the three.
- A type alias of the function type, which the conditional type names as it names the interface, gave the counts of the interface for the uses of a helper, and added 3 instantiations rather than 1 to 2 of the other benchmarks, the first unbound query and the first query of a deep relation graph.
