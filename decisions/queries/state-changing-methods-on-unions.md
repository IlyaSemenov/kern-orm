# State-changing methods on unions of queries

A method that changes the state of a query takes the state and the kind of the query, so a union of queries of different states rejects it.

```ts
const forms = single ? db.form.select("id").take() : db.form.select("id").limit(20)

forms.where({ published: true }) // keeps the state, so it takes the union
forms.select("name") // a type error: it changes the state
```

Two designs would apply such a method to a union of queries too, and both cost more than the contract is worth:

- The method takes the whole query and returns a distributive conditional type of it, such as `Q extends SelectQuery<infer S, infer Kind> ? SelectQuery<ChangeState<S, …>, Kind> : never`.
  Each query then takes ~10% to ~70% more instantiations, such as ~65% more for `find` and `findBy` and ~25% more for a query of `where`, `select`, and `take` executed by `$execute`, and ~35% more for each further copy of that query ([benchmark](../../benchmarks/types/queries.bench.ts)).
- Each overload of the method is followed by a fallback overload of that form, which TypeScript tries only when the overload does not apply, such as on a union:

  ```ts
  take<S extends SelectQueryState, Kind extends SelectQueryKind>(
    this: SelectQuery<S, Kind>,
  ): SelectQuery<ChangeState<S, { rows: OneRow<S["rows"]> }>, Kind>
  take<Q extends AnySelectQuery>(
    this: Q,
  ): Q extends SelectQuery<infer S, infer Kind>
    ? SelectQuery<ChangeState<S, { rows: OneRow<S["rows"]> }>, Kind>
    : never
  ```

  A probe of `take` kept the cost of an ordinary query, but the fallbacks double the overloads of `select`, `get`, and `pluck` that declarations and editors show, and a call that matches no overload also reports the errors of the fallbacks, or only that of the last one, which is a fallback.
