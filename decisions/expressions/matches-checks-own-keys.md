# `matches` checks its object by its own keys

Types check the object of `matches` by its own keys, so that `matches(form, { published: true })` reads the operand of `published` alone:

```ts
function matches<R extends object, const V extends { readonly [K in ColumnRefKey<R>]?: unknown }>(
  columns: R,
  values: V & MatchCheck<R, V>,
): Expression<MatchResult<R, V>>

type MatchCheck<R, V> = {
  readonly [K in keyof V]: K extends ColumnRefKey<R>
    ? MatchValue<R[K]>
    : NotAColumn<ColumnRefKey<R>>
}
```

- A constraint of the values of every column instead added about 30% to a further call in a probe:

  ```ts
  function matches<
    R extends object,
    const V extends { readonly [K in ColumnRefKey<R>]?: MatchValue<R[K]> },
  >(columns: R, values: V): Expression<MatchResult<R, V>>
  ```

- With the chosen check, a filter of `matches` takes about 2.3 times the instantiations of a filter of `eq` of a column ([benchmark](../../benchmarks/types/queries.bench.ts)).
