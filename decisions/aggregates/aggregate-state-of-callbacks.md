# State of an aggregate of a callback

The state of an aggregate method of a callback is an alias of its own, which adds the relations of the query that the callback returns, so that an aggregate of a column and `count()` pay nothing for them.

```ts
db.form.count() // AggregateState
db.form.max(form => form.fields.count()) // OperandAggregateState, which adds the relation `fields`
```

```ts
type AggregateState<S, V, Type> = ChangeState<
  S,
  { result: V; valueType: Type; rows: "one"; value: true; guaranteed: false; aggregate: true }
>

type OperandAggregateState<S, V, Type, E> = ChangeState<
  S,
  {
    result: V
    valueType: Type
    rows: "one"
    value: true
    guaranteed: false
    aggregate: true
    uses: S["uses"] | OperandUses<E>
  }
>
```

- The relations cost about 7 instantiations to `get` and `pluck`, 10 to an aggregate method, and 12 to `get` after a mutation, 2% to 5% of such a query ([benchmark](../../benchmarks/types/queries.bench.ts)).
- A parameter of `AggregateState` for the relations would make every aggregate and `exists` cost more, such as about 3% for `count` and for `exists` of a relation ([benchmark](../../benchmarks/types/queries.bench.ts)).
- `ChangeState` of the result of `AggregateState` that adds the relations would cost an aggregate of a callback about 17% more.
