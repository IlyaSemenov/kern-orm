# Changes of the state of a mutation

The methods of a mutation change its state by `ChangeMutationState`, a mapped type of its own, apart from `ChangeState` of select queries.

```ts
type ChangeState<S extends SelectQueryState, Changes extends Partial<SelectQueryState>> = {
  readonly [K in keyof SelectQueryState]: K extends keyof Changes ? Changes[K] : S[K]
} & {}

type ChangeMutationState<
  S extends MutationQueryState,
  Changes extends Partial<MutationQueryState>,
> = {
  readonly [K in keyof MutationQueryState]: K extends keyof Changes ? Changes[K] : S[K]
} & {}
```

One type for both would remove the copy:

- A parameter of the parts of the state made each change of a select query cost more instantiations, such as 40% more for a helper.
- One alias of the mapped type for both, declared apart from `SelectQuery`, made the methods that change the state reject a union of queries that differ by their fields, such as `cond ? query.select("id", "title") : query.select("id")`, which TypeScript reduces to one query only when `ChangeState` is declared in the module of `SelectQuery`.
